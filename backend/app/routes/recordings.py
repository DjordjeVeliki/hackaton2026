import hashlib
import time
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Form, Query, UploadFile
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore as gcf

from .. import blobs, firebase, tasks
from ..ai_client import AIError, get_ai
from ..auth import User, current_user, get_event, get_talk, is_member, require_member
from ..config import get_settings
from ..errors import ApiError, ai_unavailable, bad_request, forbidden, not_found
from ..policy import norm_topic
from ..schemas import (CatchUp, CatchUpRequest, ChunkAccepted, Explanation, ExplainRequest, LiveAccepted,
                       LiveTextIn, RecordingStarted, Segment, SegmentPage, Stopped, TalkTranscript, TextSegmentIn)
from .events import private_profile_ref

router = APIRouter()

AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/mpeg"}
MAX_CATCH_UP_MS = 10 * 60 * 1000
EXPLAIN_CONTEXT_MS = 60 * 1000


def rec_ref(recording_id: str):
    return firebase.db().collection("recordings").document(recording_id)


def chunk_ref(recording_id: str, sequence: int):
    return rec_ref(recording_id).collection("chunks").document(f"{sequence:08d}")


def segment_id(recording_id: str, sequence: int) -> str:
    return f"{recording_id}-{sequence}"


def to_segment(rid: str, c: dict) -> dict:
    return {"id": segment_id(rid, c["sequence"]), "sequence": c["sequence"], "start_ms": c["start_ms"],
            "end_ms": c["end_ms"], "text": c.get("text") or "", "status": c["status"]}


def get_recording(recording_id: str) -> dict:
    snap = rec_ref(recording_id).get()
    if not snap.exists:
        raise not_found("Recording")
    return {"id": snap.id, **snap.to_dict()}


def is_talk_source(rec: dict) -> bool:
    talk = firebase.db().collection("talks").document(rec["talk_id"]).get()
    return talk.exists and ((talk.to_dict().get("transcript_source") or {}).get("recording_id") == rec["id"])


# Read access granted for (recording, user) is remembered briefly: polling every second would
# otherwise cost 3 Firestore reads per request before the actual query.
READ_GRANT_SECONDS = 30
_read_grants: dict[tuple[str, str], tuple[dict, float]] = {}


def readable_recording(recording_id: str, user: User) -> dict:
    """Owner, or any event member when the recording is the organizer-designated talk transcript."""
    grant = _read_grants.get((recording_id, user.uid))
    if grant and time.monotonic() - grant[1] < READ_GRANT_SECONDS:
        return grant[0]
    rec = get_recording(recording_id)
    if rec["owner_uid"] == user.uid or (is_member(rec["event_id"], user.uid) and is_talk_source(rec)):
        _read_grants[(recording_id, user.uid)] = (rec, time.monotonic())
        return rec
    raise forbidden("Not your recording")


def owned_recording(recording_id: str, user: User) -> dict:
    rec = get_recording(recording_id)
    if rec["owner_uid"] != user.uid:
        raise forbidden("Not your recording")
    return rec


def processed_segments(recording_id: str) -> list[dict]:
    chunks = rec_ref(recording_id).collection("chunks").where("status", "in", ["ready", "gap"]).stream()
    return sorted((c.to_dict() for c in chunks), key=lambda c: c["sequence"])


def _bump_stat(event_id: str, field: str) -> None:
    firebase.db().collection("event_stats").document(event_id).set({field: gcf.Increment(1)}, merge=True)


# v1.1 live (interim) text: kept in process memory only, so it costs no Firestore writes.
# Single-instance MVP; with several backend instances this would need a shared store.
LIVE_TTL_SECONDS = 6
_live_text: dict[str, tuple[str, float]] = {}
_live_publishers: dict[str, str] = {}  # recording_id -> uid already authorized to publish


def is_trusted_source(talk: dict, uid: str) -> bool:
    """Speakers of the talk and event organizers may produce the authoritative transcript."""
    event = get_event(talk["event_id"])
    return uid in talk.get("speaker_uids", []) or uid in event.get("organizer_uids", [])


@router.post("/talks/{talk_id}/recordings", response_model=RecordingStarted)
def start_recording(talk_id: str, user: User = Depends(current_user)):
    talk = get_talk(talk_id)
    require_member(talk["event_id"], user)
    s = get_settings()
    rid = uuid.uuid4().hex
    started = firebase.now()
    rec_ref(rid).set({"talk_id": talk_id, "event_id": talk["event_id"], "owner_uid": user.uid, "mode": "live",
                      "status": "active", "started_at": started, "sample_rate_hz": s.sample_rate_hz,
                      "chunk_seconds": s.chunk_seconds})
    if user.uid in talk.get("speaker_uids", []):
        # v1.1: the talk's own speaker starting transcription makes it the authoritative source and the talk live.
        update = {"transcript_source": {"recording_id": rid, "configured_by": user.uid, "configured_at": started}}
        if talk.get("status") == "scheduled":
            update["status"] = "live"
        firebase.db().collection("talks").document(talk_id).update(update)
    return RecordingStarted(recording_id=rid, mode="live", started_at=firebase.rfc3339(started),
                            sample_rate_hz=s.sample_rate_hz, chunk_seconds=s.chunk_seconds)


@router.get("/talks/{talk_id}/transcript", response_model=TalkTranscript)
def talk_transcript(talk_id: str, user: User = Depends(current_user)):
    """v1.1: lets every event member find the talk's authoritative transcript recording."""
    talk = get_talk(talk_id)
    require_member(talk["event_id"], user)
    rid = (talk.get("transcript_source") or {}).get("recording_id")
    if not rid:
        return TalkTranscript(recording_id=None, status="none")
    snap = rec_ref(rid).get()
    if not snap.exists:
        return TalkTranscript(recording_id=None, status="none")
    return TalkTranscript(recording_id=rid, status="active" if snap.get("status") == "active" else "stopped")


@router.post("/recordings/{recording_id}/text-segments", response_model=ChunkAccepted, status_code=202)
def upload_text_segment(recording_id: str, body: TextSegmentIn, user: User = Depends(current_user)):
    """v1.1: text recognized on the speaker's device. Stored as a ready segment (no audio, no AI call)."""
    s = get_settings()
    rec = owned_recording(recording_id, user)
    if not is_trusted_source(get_talk(rec["talk_id"]), user.uid):
        raise forbidden("Only the talk's speaker or an organizer can publish transcript text")
    if rec["status"] != "active":
        raise ApiError(409, "RECORDING_STOPPED", "Recording is stopped")
    text = " ".join(body.text.split())[:5000]
    seq = body.sequence
    existing = chunk_ref(recording_id, seq).get()
    if existing.exists:  # idempotent retry
        if existing.get("text") == text:  # stored start_ms may have been reconciled, so compare text only
            return ChunkAccepted(sequence=seq)
        raise ApiError(409, "CHUNK_CONFLICT", "A different segment with this sequence exists")
    # Sequences must stay contiguous: GET /segments only returns a gap-free prefix.
    if seq > 0 and not chunk_ref(recording_id, seq - 1).get().exists:
        raise ApiError(409, "SEQUENCE_GAP", "Previous sequence has not been received")
    start_ms, end_ms = body.start_ms, body.end_ms
    if seq > 0:
        start_ms = max(start_ms, chunk_ref(recording_id, seq - 1).get().get("end_ms"))
    end_ms = max(end_ms, start_ms + 1)
    elapsed_ms = int((firebase.now() - rec["started_at"]).total_seconds() * 1000)
    if end_ms > elapsed_ms + s.clock_skew_ms:
        raise bad_request("Segment ends in the future relative to recording start", "INVALID_CHUNK_TIMING")
    started = rec["started_at"]
    try:
        chunk_ref(recording_id, seq).create({
            "sequence": seq, "start_ms": start_ms, "end_ms": end_ms,
            "start_at": started + timedelta(milliseconds=start_ms), "end_at": started + timedelta(milliseconds=end_ms),
            "status": "ready", "text": text, "source": "speaker_device", "accepted_at": firebase.now(),
            "processed_at": firebase.now()})
    except AlreadyExists:
        return ChunkAccepted(sequence=seq)
    return ChunkAccepted(sequence=seq)


@router.post("/recordings/{recording_id}/chunks", response_model=ChunkAccepted, status_code=202)
def upload_chunk(recording_id: str, file: UploadFile, sequence: int = Form(ge=0, le=100_000),
                 start_ms: int = Form(ge=0), end_ms: int = Form(ge=0), user: User = Depends(current_user)):
    s = get_settings()
    rec = owned_recording(recording_id, user)
    if rec["status"] != "active":
        raise ApiError(409, "RECORDING_STOPPED", "Recording is stopped")
    if end_ms <= start_ms or end_ms - start_ms > 2 * s.chunk_seconds * 1000:
        raise bad_request("Chunk duration out of bounds", "INVALID_CHUNK_TIMING")
    elapsed_ms = int((firebase.now() - rec["started_at"]).total_seconds() * 1000)
    if end_ms > elapsed_ms + s.clock_skew_ms:
        raise bad_request("Chunk ends in the future relative to recording start", "INVALID_CHUNK_TIMING")
    content_type = (file.content_type or "").split(";")[0].strip()
    if content_type not in AUDIO_TYPES:
        raise ApiError(415, "UNSUPPORTED_FILE", "Unsupported audio type")
    data = file.file.read(s.max_chunk_bytes + 1)
    if not data or len(data) > s.max_chunk_bytes:
        raise ApiError(413, "FILE_TOO_LARGE", "Audio chunk empty or too large")

    existing = chunk_ref(recording_id, sequence).get()
    if existing.exists:  # idempotent retry of the same chunk
        if existing.get("start_ms") == start_ms and existing.get("end_ms") == end_ms \
                and existing.get("sha256") == hashlib.sha256(data).hexdigest():
            return ChunkAccepted(sequence=sequence)
        raise ApiError(409, "CHUNK_CONFLICT", "A different chunk with this sequence exists")
    if sequence > 0:
        prev = chunk_ref(recording_id, sequence - 1).get()
        if prev.exists and start_ms < prev.get("end_ms") - 1000:
            raise bad_request("Chunk overlaps previous chunk", "INVALID_CHUNK_TIMING")
        if prev.exists:
            start_ms = max(start_ms, prev.get("end_ms"))  # reconcile small client overlap
            if start_ms >= end_ms:
                raise bad_request("Chunk overlaps previous chunk", "INVALID_CHUNK_TIMING")

    blob = f"audio/{recording_id}/{sequence:08d}"
    blobs.put(blob, data, content_type)
    started = rec["started_at"]
    try:
        chunk_ref(recording_id, sequence).create({
            "sequence": sequence, "start_ms": start_ms, "end_ms": end_ms,
            "start_at": started + timedelta(milliseconds=start_ms), "end_at": started + timedelta(milliseconds=end_ms),
            "status": "pending", "text": "", "blob": blob, "content_type": content_type,
            "sha256": hashlib.sha256(data).hexdigest(), "accepted_at": firebase.now()})
    except AlreadyExists:  # concurrent duplicate; first writer wins
        return ChunkAccepted(sequence=sequence)
    tasks.enqueue(f"tr_{recording_id}_{sequence}", "transcribe", {"recording_id": recording_id, "sequence": sequence})
    return ChunkAccepted(sequence=sequence)


@router.get("/recordings/{recording_id}/segments", response_model=SegmentPage)
def segments(recording_id: str, after_sequence: int = Query(default=-1, ge=-1),
             limit: int = Query(default=50, ge=1, le=200), user: User = Depends(current_user)):
    readable_recording(recording_id, user)
    chunks = (rec_ref(recording_id).collection("chunks").where("sequence", ">", after_sequence)
              .order_by("sequence").limit(limit).stream())
    items, lag_ms, expected = [], 0, after_sequence + 1
    for snap in chunks:
        c = snap.to_dict()
        # Return only a contiguous processed prefix so clients never skip a pending sequence.
        if c["sequence"] != expected or c["status"] == "pending":
            if c["status"] == "pending":
                lag_ms = int((firebase.now() - c["accepted_at"]).total_seconds() * 1000)
            break
        items.append(Segment(**to_segment(recording_id, c)))
        expected += 1
    live = _live_text.get(recording_id)
    live_text = live[0] if live and time.monotonic() - live[1] < LIVE_TTL_SECONDS else ""
    return SegmentPage(items=items, next_after_sequence=expected - 1, processing_lag_ms=max(0, lag_ms),
                       live_text=live_text)


@router.put("/recordings/{recording_id}/live", response_model=LiveAccepted)
def put_live_text(recording_id: str, body: LiveTextIn, user: User = Depends(current_user)):
    """v1.1: the speaker's in-progress words, shown to attendees in near real time (not part of the transcript)."""
    if _live_publishers.get(recording_id) != user.uid:  # authorize once per recording, then skip Firestore reads
        rec = owned_recording(recording_id, user)
        if not is_trusted_source(get_talk(rec["talk_id"]), user.uid):
            raise forbidden("Only the talk's speaker or an organizer can publish live text")
        if rec["status"] != "active":
            raise ApiError(409, "RECORDING_STOPPED", "Recording is stopped")
        _live_publishers[recording_id] = user.uid
    _live_text[recording_id] = (" ".join(body.text.split())[:1000], time.monotonic())
    return LiveAccepted()


@router.post("/recordings/{recording_id}/stop", response_model=Stopped)
def stop(recording_id: str, user: User = Depends(current_user)):
    owned_recording(recording_id, user)
    _live_text.pop(recording_id, None)
    _live_publishers.pop(recording_id, None)
    rec_ref(recording_id).update({"status": "stopped", "stopped_at": firebase.now()})
    return Stopped()


@router.post("/recordings/{recording_id}/catch-up", response_model=CatchUp)
def catch_up(recording_id: str, body: CatchUpRequest, user: User = Depends(current_user)):
    rec = readable_recording(recording_id, user)
    if body.end_ms <= body.start_ms or body.end_ms - body.start_ms > MAX_CATCH_UP_MS:
        raise bad_request("Catch-up range must be positive and at most 10 minutes")
    segs = [to_segment(recording_id, c) for c in processed_segments(recording_id)
            if c["status"] == "ready" and c["text"] and c["end_ms"] > body.start_ms and c["start_ms"] < body.end_ms]
    if not segs:
        raise ApiError(409, "NO_CONTEXT", "No transcribed speech in this range yet")
    try:
        r = get_ai().catch_up(segs, get_event(rec["event_id"]).get("locale", "sr"))
    except AIError:
        raise ai_unavailable() from None
    allowed = {s["id"] for s in segs}
    _bump_stat(rec["event_id"], "catch_up_count")
    return CatchUp(cue=r.cue, summary=r.summary, source_segment_ids=[i for i in r.source_segment_ids if i in allowed],
                   start_ms=body.start_ms, end_ms=body.end_ms)


@router.post("/recordings/{recording_id}/explanations", response_model=Explanation)
def explain(recording_id: str, body: ExplainRequest, user: User = Depends(current_user)):
    rec = readable_recording(recording_id, user)
    all_segs = processed_segments(recording_id)
    target = next((c for c in all_segs if segment_id(recording_id, c["sequence"]) == body.segment_id), None)
    if target is None or target["status"] != "ready":
        raise not_found("Segment")
    term = " ".join(body.selected_text.split())
    if norm_topic(term) not in norm_topic(target["text"]):
        raise bad_request("Selected text must come from the segment")
    context = [to_segment(recording_id, c) for c in all_segs
               if c["status"] == "ready" and target["end_ms"] - EXPLAIN_CONTEXT_MS <= c["start_ms"] <= target["start_ms"]]
    private = private_profile_ref(rec["event_id"], user.uid).get().to_dict() or {}
    try:
        r = get_ai().explain(term, context, private.get("topic_estimates", []), body.depth,
                             get_event(rec["event_id"]).get("locale", "sr"))
    except AIError:
        raise ai_unavailable() from None
    term_doc = hashlib.sha256(norm_topic(term).encode()).hexdigest()[:32]
    firebase.db().collection("event_stats").document(rec["event_id"]).collection("terms").document(term_doc).set(
        {"term": norm_topic(term), "count": gcf.Increment(1)}, merge=True)
    return Explanation(explanation=r.explanation, example=r.example,
                       sources=[s.model_dump() for s in r.sources], retrieval_mode=r.retrieval_mode)


# ---------- background transcription ----------

def run_transcribe(payload: dict) -> None:
    ref = chunk_ref(payload["recording_id"], payload["sequence"])
    c = ref.get().to_dict()
    if not c or c["status"] != "pending":
        return
    rec = get_recording(payload["recording_id"])
    audio = blobs.get(c["blob"])
    r = get_ai().transcribe(audio, c["content_type"], get_event(rec["event_id"]).get("locale", "sr"))
    ref.update({"status": "ready", "text": " ".join(r.text.split())[:5000], "model_id": r.model_id,
                "processed_at": firebase.now()})
    blobs.delete(c["blob"])  # audio is only kept until transcribed


def fail_transcribe(payload: dict, error: str) -> None:
    # Honest gap instead of invented text.
    ref = chunk_ref(payload["recording_id"], payload["sequence"])
    ref.update({"status": "gap", "text": "", "processed_at": firebase.now()})
    blobs.delete(ref.get().get("blob"))


tasks.register("transcribe", run_transcribe, fail_transcribe)
