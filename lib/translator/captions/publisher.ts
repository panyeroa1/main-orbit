import type { Call } from "@stream-io/video-react-sdk";

import type { TranscriptResult } from "../stt";
import { createWebSpeechSTT } from "../stt/webspeech";

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
  const { call, speakerUserId, speakerName, sourceLang, maxEventChars } =
    options;
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

  const stt = createWebSpeechSTT({
    onResult: handleResult,
    onError: (error) => {
      console.error("Caption publisher error:", error);
    },
    lang: sourceLang,
  });

  const start = () => {
    if (active) return;
    active = true;
    stt.start();
  };

  const stop = () => {
    active = false;
    currentUtteranceId = null;
    stt.stop();
  };

  return { start, stop };
};
