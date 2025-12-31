Task ID: T-0018
Title: Fix Deepgram Transcription Stopping
Status: DONE
Owner: Miles

Start log:
- Timestamp: 2025-12-31 12:40
- Plan: Add keepalive and auto-reconnect to Deepgram WebSocket.

End log:
- Timestamp: 2025-12-31 12:45
- Changed:
  - Added 5-second keepalive ping to prevent Deepgram timeout.
  - Implemented auto-reconnect (2s delay) on socket close/error.
  - Cleaned up interval on disconnect.
- Tests: Build passed successfully.
- Status: DONE
