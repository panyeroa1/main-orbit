"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { useTranslatorStore } from "@/store/use-translator";

export const CaptionsOverlay = () => {
  const captions = useTranslatorStore((state) => state.captionBuffer);
  const enabled = useTranslatorStore((state) => state.enabled);
  const showOriginal = useTranslatorStore((state) => state.showOriginal);
  const autoTranslateEnabled = useTranslatorStore(
    (state) => state.autoTranslateEnabled
  );
  const targetLang = useTranslatorStore((state) => state.targetLang);

  const visibleCaptions = useMemo(() => {
    const sorted = [...captions].sort((a, b) => a.ts - b.ts);
    return sorted.slice(-2);
  }, [captions]);

  if (!enabled && visibleCaptions.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-40 flex w-full max-w-[min(920px,95vw)] -translate-x-1/2 flex-col gap-2">
      {visibleCaptions.map((caption) => {
        const showTranslation =
          autoTranslateEnabled && Boolean(targetLang) && caption.translatedText;
        return (
          <div
            key={caption.utteranceId}
            className={cn(
              "flex w-full flex-col gap-1 rounded-lg bg-black/70 px-4 py-2 text-white shadow-lg backdrop-blur-md"
            )}
          >
            <div className="flex items-center gap-2 overflow-hidden">
              {caption.speakerName && (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-sky-400">
                  {caption.speakerName}:
                </span>
              )}
              <div className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium">
                {caption.text}
              </div>
            </div>
            {showTranslation && (
              <div className="flex items-baseline gap-2 border-t border-white/5 pt-1 text-sm font-semibold text-lime-400">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider">
                  Translation:
                </span>
                <div className="min-w-0 flex-1 truncate whitespace-nowrap">
                  {caption.translatedText}
                </div>
              </div>
            )}
            {!showTranslation && showOriginal && caption.translatedText && (
              <div className="border-t border-white/5 pt-1 text-sm text-white/50 truncate whitespace-nowrap italic">
                {caption.translatedText}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
