# Transcription & Translation Flow (Current State)

## Capture & Broadcast
- Speech is captured in the browser:
  - Web Speech API (default) or Deepgram WebSocket if `NEXT_PUBLIC_DEEPGRAM_API_KEY` is set (key is exposed client‑side for the current MVP).
- Captions are sent as Stream custom events (`caption.partial` / `caption.final`) via `createCaptionPublisher` with chunking and throttling for partials.

## In-Call Handling (`components/meeting-room.tsx`)
- Custom events are consumed and captions are upserted locally for the overlay.
- On final captions:
  - A request is sent to `/api/translate` with `{ text, sourceLang, targetLang }`.
  - The returned `translatedText` updates the caption overlay (per-utterance).
  - A transcript POST to `/api/transcripts` saves raw text into Supabase `transcriptions`.

## Persistence
- `/api/transcripts` inserts rows into the Supabase `transcriptions` table with:
  - `user_id`, `room_name` (meetingId), `sender`, `text`, `created_at`.
- `/api/translate` inserts rows into Supabase `translations` with:
  - `user_id`, `source_lang`, `target_lang`, `original_text`, `translated_text` (no `meeting_id` at present).

## Translation
- `/api/translate` flow:
  1) Tries Ollama (cloud) `OLLAMA_MODEL` at `OLLAMA_API_URL` with `OLLAMA_API_KEY` (streaming).
  2) Falls back to Google free translate.
  3) If both fail, returns 502.
- Results are cached in-memory per `{sourceLang}:{targetLang}:{text}`.
- On success, the translation is persisted to `translations`.

## TTS
- Cartesia TTS: `/api/tts` uses `CARTESIA_API_KEY` and plays audio locally.
- “Translator” speaker toggle in-call polls `/api/transcriptions/latest?meetingId=...` every few seconds:
  - Re-translates the latest transcription on the fly to `targetLang` via `/api/translate`.
  - Sends the translated text to `/api/tts` for playback.
  - Note: this currently re-translates instead of reading from saved `translations`, and does not include `meeting_id` in translation records.

## Key Gaps / Risks
- `translations` are not linked to `meeting_id`, so per-meeting translation history cannot be queried directly.
- TTS poll re-translates each time; more load and risk of inconsistency.
- `transcriptions` insert uses `room_name` but may create rows with empty meetingId if not present.
- Deepgram key is client-exposed (`NEXT_PUBLIC_DEEPGRAM_API_KEY`).
- Websocket guard was hotpatched in `node_modules`; will be lost on reinstall.
- No UI feedback on translate/TTS failures; polls retry silently.

## Suggested Improvements
1) Add `meeting_id` to `translations` and include it in `/api/translate` writes; read for TTS instead of re-translating.
2) Ensure `transcriptions` inserts always include a valid meetingId and correct `user_id` type per schema.
3) Cache per-utterance per-meeting per-targetLang to avoid repeated translations.
4) Move Deepgram to server-issued tokens or restrict to Web Speech on public clients.
5) Make the websocket upgrade guard durable (custom middleware or patch script).
6) Surface errors in UI/backoff polling to reduce silent failures.
