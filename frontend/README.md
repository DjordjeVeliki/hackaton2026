# Cuevia — frontend

React + TypeScript + Vite UI for Cuevia. Talks only to the **public backend API** (`contracts/http-v1.md`, v1).
It never calls the private AI service, Gemma or a search API. On the speaker's phone it uses browser speech
recognition (Web Speech API) to publish the live transcript; attendees only read it from the backend.

Owner: Laptop 1 (`feature/frontend`). This folder is the only write scope of that role.

## Setup

```bash
cd frontend
npm ci                 # or npm install
cp .env.example .env.local   # fill in public Firebase web config
npm run dev            # http://localhost:5173, real Firebase + http://localhost:8000/api/v1
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server against the real backend + Firebase Auth (default). |
| `npm run dev:mock` | Dev server with the **synthetic** transport in `src/dev/` (`.env.mock` sets `VITE_USE_MOCKS=true`). Shows a yellow banner. |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | Vitest + Testing Library (jsdom). |
| `npm run build` | Typecheck + production build to `frontend/dist`. |

### Environment (`.env.example`)

Only public values: `VITE_API_BASE_URL` (default `http://localhost:8000/api/v1`), `VITE_FIREBASE_*` web config,
`VITE_FIREBASE_GOOGLE_ENABLED` (shows Google sign-in only when `true`), `VITE_USE_MOCKS` (default `false`).
No AI token, model key or service-account JSON ever goes here.

### Hosting

`npm run build` outputs static files to **`frontend/dist`**. Firebase Hosting root config is owned by the
backend/integrator; point its `public` at `frontend/dist` with an SPA rewrite to `/index.html`.

## Structure

```
src/api/        typed public-API client, response sanitizers, query hooks, transcript merge
src/auth/       Firebase email/password (+ optional Google) auth; ID tokens for the API
src/audio/      AudioWorklet capture → resample → fixed chunks → 16-bit PCM WAV → bounded upload queue
src/components/ UI primitives (Radix Dialog/Slider), drawers, transcript, recorder controls
src/pages/      attendee, speaker, sponsor, organizer screens
src/dev/        DEVELOPMENT-ONLY synthetic transport + auth (tree-shaken unless VITE_USE_MOCKS=true)
public/worklets/pcm-capture.js  AudioWorkletProcessor (mono downmix only)
```

## How it behaves

- **Auth**: Firebase ID token in `Authorization: Bearer`. On 401 the client force-refreshes the token once
  and retries; a second 401 signs the user out and shows “Sesija je istekla”. Roles come only from `GET /me`.
- **Privacy**: every response is whitelist-copied into public types (`src/api/sanitize.ts`); unknown fields,
  including any score/rank the server might leak, are dropped. Attendees see CV status, `N/A`/`procenjena`,
  eligibility and interests — never numbers, ratings or rank. No leaderboard.
- **CV**: optional after joining (`/events/:id/cv`, “Preskoči za sada”). Status polls every 2 s while
  `uploaded/processing`. Upload/replace/remove later from Profile. Max 10 MB, PDF/DOCX/TXT (client-side check only).
- **Recording**: `POST /talks/{id}/recordings` → uses the returned `sample_rate_hz` and `chunk_seconds`.
  Mic → AudioWorklet (ScriptProcessor fallback) → mono → anti-aliased resample → exact-length chunks →
  WAV PCM16. `start_ms/end_ms` are recording-relative **milliseconds** from sample counts; pause leaves a gap.
  Upload queue: sequential, max 30 waiting chunks (oldest dropped → backend gap), exponential backoff for
  network/408/429/5xx, the same `sequence` on every retry. The recorder is app-level, so drawers and navigation
  never stop it. A `mode: "replay"` session is labeled “Reprodukcija — nije uživo”.
- **Transcript**: polls `segments?after_sequence=<cursor>` every 2 s while recording (and while
  `processing_lag_ms > 0`), merges only unseen sequences, shows `gap` segments as visible breaks. History slider +
  “Vrati se uživo”.
- **Live transcript (speaker-driven, v1.1)**: only a user with the `speaker` role sees one large
  “▶ Pokreni transkripciju” button on the talk page (`components/SpeakerLive.tsx`). Pressing it calls
  `POST /talks/{id}/recordings`. For the talk's own speaker the backend makes that recording the talk's transcript
  source and sets the talk `live`. The speaker's browser recognizes speech (Web Speech API, sr-RS/hr-HR/en-US,
  auto-restart, screen wake lock) and `audio/speakerTranscription.ts` publishes every finalized utterance in order
  to `POST /recordings/{id}/text-segments`. Sequences are assigned at send time, network errors retry with the
  same sequence, and rejected text is dropped without leaving a gap. Attendees never record: the page finds the
  live recording through `GET /talks/{id}/transcript` (polled every 4 s) and reads segments as before. Catch-up,
  explanations and question context therefore all run on the speaker's transcript. Speakers don't get the
  question button. Recognition is done by the browser vendor's speech service (Chrome/Edge), not by Gemma.
- **Mobile**: bottom tab bar on phones, safe-area insets (notch/home indicator), ≥44 px touch targets,
  16 px inputs (no iOS zoom), no tap flash or overscroll bounce, installable PWA (`public/manifest.webmanifest`,
  icons). Routes are lazy-loaded and libraries are split into long-cached chunks (react / firebase / vendor).
  Firebase Auth uses `initializeAuth`, and the Google popup code loads only on demand.
- **Izgubio sam nit**: 30 s / 1 min / 3 min / from start, computed from the latest segment `end_ms`.
- **Explanations**: select text in the transcript (or type a term) → drawer; depth buttons re-query backend.
  `retrieval_mode: general` is labeled “Opšte znanje modela — bez web izvora”. Only http(s) links, opened with
  `rel="noopener noreferrer"`.
- **Questions**: round “?” button → drawer with own questions, X/3 counter, plain text. No AI replies.
  A `client_request_id` (UUID) is kept for the same text until the server confirms, so retries never use a
  second slot. 409 `QUESTION_LIMIT_REACHED` / other 409 → keep the text, resync quota and list.
- **Sharing**: per recipient `PUT /consents/{recipient_id}` (allow CV / allow questions).
- **Speaker** questions grouped by talk + mark read; **Sponsor** opportunities, create, recommendations with
  shared questions and authenticated CV download (blob); **Organizer** transcript source, finalize, metrics
  (Recharts, server numbers only, with table view).

## Integration assumptions (please confirm — backend owner)

1. Role strings from `GET /me`: `attendee`, `speaker`, `sponsor`, `organizer`. Nav links are hidden otherwise;
   the backend still enforces access.
2. Chunk upload multipart fields: `file` (`audio/wav`, PCM16 mono at `sample_rate_hz`, name `chunk-000000.wav`),
   `sequence`, `start_ms`, `end_ms` as decimal strings. First `sequence` is `0`. Backend dedupes repeated sequences.
3. `GET /segments` returns items with `sequence > after_sequence` ordered by sequence; `next_after_sequence` is the
   cursor for the next call. Segment `sequence` need not equal chunk sequence.
4. Recording “resume” after pause continues the **same** `recording_id`; there is no pause endpoint in v1. A
   pause produces a time gap in `start_ms` (no audio sent for it).
5. v1 has **no GET for consents**: the UI shows the choice saved in this session and says when it is unknown.
   Suggest a v1.1 `GET /events/{id}/consents`. Default assumed: nothing shared until the attendee opts in.
6. `GET /sponsor/.../recommendations` returns `items: []` (not an error) before finalization; errors are shown as-is.
7. `POST /events/{id}/cv` returns `202 {cv_status:"processing"}`; profile then moves to `parsed`/`failed`.
8. Catch-up / explanation request bodies are exactly as in the contract (no `locale`; backend picks it).
9. Errors follow `{"error":{"code","message","request_id"}}`; `message` is shown to users, `request_id` is shown
   for support.

## Known limitations

- `firebase@13` declares `node >=24.12`; install/build/tests were verified on Node 22.18 (engine warning only).
  Prefer Node 24 LTS for CI.
- **Microphone needs a secure context.** `getUserMedia` works on `https://` or `http://localhost` only. A phone
  opening `http://<laptop-ip>:5173` will be refused — use an HTTPS tunnel or hosted HTTPS build.
- iOS Safari suspends audio when the screen locks or the app is backgrounded; we request a Screen Wake Lock
  where supported, but keep the phone unlocked. A revoked/ended mic track pauses the recording with a message.
- Firefox cannot connect a mic to an `AudioContext` with a non-native sample rate; we fall back to the native
  rate and resample in JS (FIR low-pass + linear interpolation).
- Live ASR quality depends entirely on the backend/Gemma audio endpoint. The frontend tests only prove that
  valid WAV chunks are produced and uploaded; **they do not prove live transcription works.** Mock mode returns
  labeled placeholder text, not transcription.
- Consents cannot be read back (see assumption 5).
