"use client";

import { useCallback, useEffect, useRef } from "react";

import { useTranslatorStore } from "@/store/use-translator";

type CaptionsTTSProps = {
  localUserId?: string;
};

type QueueItem = {
  utteranceId: string;
  text: string;
  lang: string;
  voice?: string;
};

export const CaptionsTTS = ({ localUserId }: CaptionsTTSProps) => {
  const captionBuffer = useTranslatorStore((state) => state.captionBuffer);
  const targetLang = useTranslatorStore((state) => state.targetLang);
  const ttsEnabled = useTranslatorStore((state) => state.ttsEnabled);
  const ttsVoice = useTranslatorStore((state) => state.ttsVoice);
  const ttsVolume = useTranslatorStore((state) => state.ttsVolume);
  const setIsTtsPlaying = useTranslatorStore((state) => state.setIsTtsPlaying);

  const spokenRef = useRef(new Map<string, string>());
  const queueRef = useRef<QueueItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  const isolationCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const playWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledAtRef = useRef<number | null>(null);

  const playNext = useCallback(async () => {
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      return;
    }

    playingRef.current = true;

    try {
      setIsTtsPlaying(true);
      if (playWatchdogRef.current) {
        clearTimeout(playWatchdogRef.current);
      }
      playWatchdogRef.current = setTimeout(() => {
        console.warn("TTS playback watchdog triggered — resetting");
        playingRef.current = false;
        setIsTtsPlaying(false);
        if (useTranslatorStore.getState().ttsEnabled) {
          void playNext();
        }
      }, 8000);
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: next.text,
          voice: next.voice,
          lang: next.lang,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("TTS request failed", response.status, errorText);
        throw new Error("TTS request failed.");
      }

      const blob = await response.blob();
      if (!useTranslatorStore.getState().ttsEnabled) {
        playingRef.current = false;
        return;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      (audio as HTMLMediaElement & { playsInline?: boolean }).playsInline = true;
      audio.crossOrigin = "anonymous";
      audio.volume = Number.isFinite(ttsVolume) ? Math.min(1, Math.max(0, ttsVolume)) : 0.75;

      audio.onended = () => {
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
        audioRef.current = null;
        if (isolationCooldownRef.current) {
          clearTimeout(isolationCooldownRef.current);
        }
        if (playWatchdogRef.current) {
          clearTimeout(playWatchdogRef.current);
          playWatchdogRef.current = null;
        }
        isolationCooldownRef.current = setTimeout(
          () => setIsTtsPlaying(false),
          200
        );
        if (useTranslatorStore.getState().ttsEnabled) {
          void playNext();
        } else {
          playingRef.current = false;
        }
      };
      audio.onerror = () => {
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
        audioRef.current = null;
        if (isolationCooldownRef.current) {
          clearTimeout(isolationCooldownRef.current);
        }
        if (playWatchdogRef.current) {
          clearTimeout(playWatchdogRef.current);
          playWatchdogRef.current = null;
        }
        isolationCooldownRef.current = setTimeout(
          () => setIsTtsPlaying(false),
          200
        );
        if (useTranslatorStore.getState().ttsEnabled) {
          void playNext();
        } else {
          playingRef.current = false;
        }
      };

      try {
        await audio.play();
      } catch (err) {
        console.error("Audio playback failed", err);
        throw err;
      }
    } catch {
      playingRef.current = false;
      if (isolationCooldownRef.current) {
        clearTimeout(isolationCooldownRef.current);
      }
      if (playWatchdogRef.current) {
        clearTimeout(playWatchdogRef.current);
        playWatchdogRef.current = null;
      }
      isolationCooldownRef.current = setTimeout(
        () => setIsTtsPlaying(false),
        200
      );
      if (useTranslatorStore.getState().ttsEnabled) {
        void playNext();
      }
    }
  }, [setIsTtsPlaying, ttsVolume]);

  useEffect(() => {
    if (!ttsEnabled) {
      queueRef.current = [];
      spokenRef.current.clear();
      enabledAtRef.current = null;
      if (isolationCooldownRef.current) {
        clearTimeout(isolationCooldownRef.current);
        isolationCooldownRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      setIsTtsPlaying(false);
      playingRef.current = false;
      return;
    }

    enabledAtRef.current = Date.now();
  }, [ttsEnabled, setIsTtsPlaying]);

  useEffect(() => {
    if (!ttsEnabled) return;

    const enabledAt = enabledAtRef.current ?? 0;

    captionBuffer.forEach((caption) => {
      if (caption.ts < enabledAt) return;
      if (caption.speakerUserId === localUserId) return;

      const translated = caption.translatedText?.trim();
      // Only speak translated text; skip if translation isn't available yet.
      if (!translated) return;

      const text = translated;
      const lang = targetLang;
      const voice = ttsVoice.trim() || undefined;

      const lastSpoken = spokenRef.current.get(caption.utteranceId) || "";
      if (text === lastSpoken) return;

      spokenRef.current.set(caption.utteranceId, text);
      queueRef.current.push({
        utteranceId: caption.utteranceId,
        text,
        lang,
        voice,
      });

      if (!playingRef.current) {
        void playNext();
      }
    });
  }, [
    captionBuffer,
    ttsEnabled,
    targetLang,
    ttsVoice,
    ttsVolume,
    localUserId,
    playNext,
  ]);

  return null;
};
