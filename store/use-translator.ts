import { create } from "zustand";

export type CaptionEntry = {
  utteranceId: string;
  speakerUserId: string;
  speakerName?: string;
  sourceLang: string;
  text: string;
  translatedText?: string;
  isFinal: boolean;
  ts: number;
};

type TranslatorState = {
  enabled: boolean;
  autoTranslateEnabled: boolean;
  targetLang: string;
  showOriginal: boolean;
  speakerLang: string;
  captionBuffer: CaptionEntry[];
  mutedSpeakersForTTS: string[];
  setEnabled: (enabled: boolean) => void;
  setAutoTranslateEnabled: (enabled: boolean) => void;
  setTargetLang: (lang: string) => void;
  setShowOriginal: (show: boolean) => void;
  setSpeakerLang: (lang: string) => void;
  upsertCaption: (caption: CaptionEntry) => void;
  updateCaptionTranslation: (utteranceId: string, translatedText: string) => void;
  clearCaptions: () => void;
};

const MAX_CAPTIONS = 20;

export const useTranslatorStore = create<TranslatorState>((set) => ({
  enabled: false,
  autoTranslateEnabled: false,
  targetLang: "en",
  showOriginal: true,
  speakerLang: "auto",
  captionBuffer: [],
  mutedSpeakersForTTS: [],
  setEnabled: (enabled) => set({ enabled }),
  setAutoTranslateEnabled: (enabled) => set({ autoTranslateEnabled: enabled }),
  setTargetLang: (targetLang) => set({ targetLang }),
  setShowOriginal: (showOriginal) => set({ showOriginal }),
  setSpeakerLang: (speakerLang) => set({ speakerLang }),
  upsertCaption: (caption) =>
    set((state) => {
      const next = [...state.captionBuffer];
      const index = next.findIndex(
        (item) => item.utteranceId === caption.utteranceId
      );

      if (index === -1) {
        next.push(caption);
      } else {
        next[index] = { ...next[index], ...caption };
      }

      next.sort((a, b) => a.ts - b.ts);

      if (next.length > MAX_CAPTIONS) {
        next.splice(0, next.length - MAX_CAPTIONS);
      }

      return { captionBuffer: next };
    }),
  updateCaptionTranslation: (utteranceId, translatedText) =>
    set((state) => ({
      captionBuffer: state.captionBuffer.map((caption) =>
        caption.utteranceId === utteranceId
          ? { ...caption, translatedText }
          : caption
      ),
    })),
  clearCaptions: () => set({ captionBuffer: [] }),
}));
