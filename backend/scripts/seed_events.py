"""Adds demo events with talks, dates and a sponsor recipient (idempotent; never touches Auth users or passwords).

Usage (from backend/, real project or emulators):  python -m scripts.seed_events
Speakers listed with uid "speaker" are the demo speaker account; other speaker names are fictional labels.
"""
from datetime import datetime, timedelta, timezone

from app import firebase

CET, CEST = timezone(timedelta(hours=1)), timezone(timedelta(hours=2))  # Europe/Belgrade winter / summer time

EVENTS = [
    {
        "id": "ai-summit-2026",
        "title": "AI Engineering Summit 2026",
        "topics": ["Machine Learning", "Large Language Models", "MLOps", "Data Engineering"],
        "starts_at": datetime(2026, 11, 14, 9, 0, tzinfo=CET),
        "ends_at": datetime(2026, 11, 14, 18, 0, tzinfo=CET),
        "talks": [
            ("ai-llm-apps", "Building Reliable LLM Applications", "Speaker", ["speaker"]),
            ("ai-eval", "Evaluating Generative Models", "Emma Clarke", []),
            ("ai-vector", "Vector Search at Scale", "Raj Patel", []),
        ],
    },
    {
        "id": "cloud-native-days-2026",
        "title": "Cloud Native Days 2026",
        "topics": ["Cloud", "Kubernetes", "DevOps", "Observability"],
        "starts_at": datetime(2026, 12, 3, 9, 0, tzinfo=CET),
        "ends_at": datetime(2026, 12, 4, 17, 0, tzinfo=CET),
        "talks": [
            ("cnd-platform", "Platform Engineering in Practice", "Speaker", ["speaker"]),
            ("cnd-cost", "Kubernetes Cost Optimization", "Laura Chen", []),
            ("cnd-otel", "Observability with OpenTelemetry", "Tom Becker", []),
        ],
    },
    {
        "id": "cybersecurity-forum-2027",
        "title": "Cybersecurity Forum 2027",
        "topics": ["Security", "Zero Trust", "Privacy", "Machine Learning"],
        "starts_at": datetime(2027, 1, 21, 10, 0, tzinfo=CET),
        "ends_at": datetime(2027, 1, 21, 17, 0, tzinfo=CET),
        "talks": [
            ("sec-zt-small", "Zero Trust for Small Teams", "Speaker", ["speaker"]),
            ("sec-ai-pipelines", "Securing AI Pipelines", "Marcus Webb", []),
        ],
    },
]


def main() -> None:
    db = firebase.db()
    for ev in EVENTS:
        db.collection("events").document(ev["id"]).set({
            "title": ev["title"], "topics": ev["topics"], "organizer_uids": ["organizer"], "locale": "en",
            "starts_at": ev["starts_at"], "ends_at": ev["ends_at"]}, merge=True)
        for tid, title, speaker_name, speaker_uids in ev["talks"]:
            db.collection("talks").document(tid).set({
                "event_id": ev["id"], "title": title, "speaker_name": speaker_name, "speaker_uids": speaker_uids,
                "status": "scheduled"}, merge=True)
        db.collection("recipients").document(f"acme-{ev['id']}").set(
            {"event_id": ev["id"], "kind": "sponsor", "name": "Acme", "member_uids": ["sponsor"]})
        for uid in ("organizer", "speaker"):
            db.collection("events").document(ev["id"]).collection("members").document(uid).set(
                {"joined_at": firebase.now()}, merge=True)
        print(f"  {ev['id']}: {len(ev['talks'])} talks, {ev['starts_at']:%Y-%m-%d %H:%M} – {ev['ends_at']:%Y-%m-%d %H:%M}")


if __name__ == "__main__":
    main()
