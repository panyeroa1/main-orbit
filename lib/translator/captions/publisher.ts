import type { Call } from "@stream-io/video-react-sdk";

import type { SpeechToTextProvider, TranscriptResult } from "../stt";
import { createWebSpeechSTT } from "../stt/webspeech";
import { createDeepgramSTT } from "../stt/deepgram";

export type CaptionEventPayload = {
  type: "caption.partial" | "caption.final" | "caption.control";
  v: 1;
  speakerUserId: string;
  speakerName?: string;
  sourceLang: string;
  text: string;
  ts: number;
  utteranceId: string;
  chunkIndex?: number;
  chunkCount?: number;
};

type CaptionPublisherOptions = {
  call: Call;
  speakerUserId: string;
  speakerName?: string;
  sourceLang: string;
  maxEventChars?: number;
  shouldCapture?: () => boolean;
};

const DEFAULT_MAX_EVENT_CHARS = 3200;
const PARTIAL_RATE_LIMIT_MS = 100;

const chunkText = (text: string, maxChars: number) => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let index = 0;

  while (index < trimmed.length) {
    chunks.push(trimmed.slice(index, index + maxChars));
    index += maxChars;
  }

  return chunks;
};

const createUtteranceId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createCaptionPublisher = (options: CaptionPublisherOptions) => {
  const {
    call,
    speakerUserId,
    speakerName,
    sourceLang,
    maxEventChars,
    shouldCapture,
  } = options;
  const maxChars = maxEventChars ?? DEFAULT_MAX_EVENT_CHARS;
  const resolvedSourceLang = sourceLang || "auto";
  let active = false;
  let currentUtteranceId: string | null = null;
  let lastPartialAt = 0;

  const sendCaption = async (
    payload: Omit<CaptionEventPayload, "v"> & { v?: 1 }
  ) => {
    try {
      await call.sendCustomEvent({ ...payload, v: 1 });
    } catch (error) {
      console.error("Failed to send caption event.", error);
    }
  };

  const handleResult = (result: TranscriptResult) => {
    if (shouldCapture && !shouldCapture()) return;
    if (!active) return;
    const text = result.text.trim();
    if (!text) return;

    const now = Date.now();
    if (!result.isFinal && now - lastPartialAt < PARTIAL_RATE_LIMIT_MS) {
      return;
    }
    if (!result.isFinal) lastPartialAt = now;

    if (!currentUtteranceId) {
      currentUtteranceId = createUtteranceId();
    }

    const chunks = chunkText(text, maxChars);
    const basePayload = {
      type: result.isFinal
        ? ("caption.final" as const)
        : ("caption.partial" as const),
      speakerUserId,
      speakerName,
      sourceLang: resolvedSourceLang,
      ts: now,
      utteranceId: currentUtteranceId,
    };

    if (chunks.length <= 1) {
      void sendCaption({ ...basePayload, text: text.slice(0, maxChars) });
    } else {
      chunks.forEach((chunk, index) => {
        void sendCaption({
          ...basePayload,
          text: chunk,
          chunkIndex: index,
          chunkCount: chunks.length,
        });
      });
    }

    if (result.isFinal) {
      currentUtteranceId = null;
    }
  };

  const hasDeepgramKey =
    typeof process !== "undefined" &&
    Boolean(process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY);

  const buildWebSpeech = () =>
    createWebSpeechSTT({
      onResult: handleResult,
      onError: (error) => {
        console.error("Caption publisher error (web speech):", error);
        // Fallback to Deepgram if Web Speech fails and key is present.
        if (hasDeepgramKey) {
          try {
            sttRef.current.stop();
          } catch {
            // ignore
          }
          sttRef.current = buildDeepgram();
          sttRef.current.start();
        }
      },
      lang: sourceLang,
    });

  const buildDeepgram = () =>
    createDeepgramSTT({
      onResult: handleResult,
      onError: (error) => {
        console.error("Caption publisher error (deepgram):", error);
        // Fallback to Web Speech if Deepgram fails mid-call.
        try {
          sttRef.current.stop();
        } catch {
          // ignore
        }
        sttRef.current = buildWebSpeech();
        sttRef.current.start();
      },
      lang: sourceLang,
    });

  const sttRef: { current: SpeechToTextProvider } = {
    current:
      typeof window !== "undefined"
        ? buildWebSpeech()
        : buildDeepgram(),
  };

  const start = () => {
    if (active) return;
    active = true;
    sttRef.current.start();
  };

  const stop = () => {
    active = false;
    currentUtteranceId = null;
    sttRef.current.stop();
  };

  return { start, stop };
};
