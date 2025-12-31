"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { useTranslatorStore } from "@/store/use-translator";

export const CaptionsOverlay = () => {
  const captions = useTranslatorStore((state) => state.captionBuffer);
  const enabled = useTranslatorStore((state) => state.enabled);
  const showOriginal = useTranslatorStore((state) => state.showOriginal);

  const visibleCaptions = useMemo(() => {
    const sorted = [...captions].sort((a, b) => a.ts - b.ts);
    return sorted.slice(-3);
  }, [captions]);

  if (!enabled && visibleCaptions.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-28 left-1/2 z-40 w-[min(720px,90vw)] -translate-x-1/2 space-y-2 text-center">
      {visibleCaptions.map((caption) => {
        const primaryText = caption.translatedText ?? caption.text;
        return (
          <div
            key={caption.utteranceId}
            className={cn(
              "rounded-2xl bg-black/60 px-4 py-2 text-white shadow-lg backdrop-blur-sm transition-all"
            )}
          >
            {caption.speakerName && (
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/70">
                {caption.speakerName}
              </div>
            )}
            <div className="text-base font-medium">{primaryText}</div>
            {showOriginal && caption.translatedText && (
              <div className="mt-1 text-sm text-white/70">{caption.text}</div>
            )}
          </div>
        );
      })}
    </div>
  );
};
