"use client";

import {
  CallControls,
  CallParticipantsList,
  CallStatsButton,
  CallingState,
  PaginatedGridLayout,
  SpeakerLayout,
  useCall,
  useCallStateHooks,
} from "@stream-io/video-react-sdk";
import { Languages, LayoutList, Users } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CaptionsTTS } from "@/components/translator/captions-tts";
import { CaptionsOverlay } from "@/components/translator/captions-overlay";
import { TranslatorModal } from "@/components/translator/translator-modal";
import { createCaptionPublisher } from "@/lib/translator/captions/publisher";
import { TARGET_LANGUAGES } from "@/constants/languages";
import { cn } from "@/lib/utils";
import { useTranslatorStore } from "@/store/use-translator";
import { Volume2 } from "lucide-react";

import { EndCallButton } from "./end-call-button";
import { Loader } from "./loader";

type CallLayoutType = "grid" | "speaker-left" | "speaker-right";
const MAX_EVENT_TEXT_LENGTH = 4000;
const PARTIAL_EVENT_THROTTLE_MS = 100;
const controlButtonClasses =
  "flex size-11 items-center justify-center rounded-[5px] border border-white/10 bg-white/5 text-white transition hover:bg-white/15";

export const MeetingRoom = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showParticipants, setShowParticipants] = useState(false);
  const [layout, setLayout] = useState<CallLayoutType>("speaker-left");
  const [isTranslatorOpen, setIsTranslatorOpen] = useState(false);
  const [isTtsFeedEnabled, setIsTtsFeedEnabled] = useState(false);
  const lastTranslationIdRef = useRef<string | null>(null);
  const params = useParams();
  const meetingId = (params as { id?: string })?.id;

  const call = useCall();
  const { user, isLoaded } = useUser();

  const { useCallCallingState, useLocalParticipant } = useCallStateHooks();
  const callingState = useCallCallingState();
  const localParticipant = useLocalParticipant();

  const captionsEnabled = useTranslatorStore((state) => state.enabled);
  const targetLang = useTranslatorStore((state) => state.targetLang);
  const speakerLang = useTranslatorStore((state) => state.speakerLang);
  const ttsVolume = useTranslatorStore((state) => state.ttsVolume);
  const setEnabled = useTranslatorStore((state) => state.setEnabled);
  const setTargetLang = useTranslatorStore((state) => state.setTargetLang);
  const setShowOriginal = useTranslatorStore((state) => state.setShowOriginal);

  const setSpeakerLang = useTranslatorStore((state) => state.setSpeakerLang);
  const setTtsEnabled = useTranslatorStore((state) => state.setTtsEnabled);
  const setTtsVoice = useTranslatorStore((state) => state.setTtsVoice);
  const setTtsVolume = useTranslatorStore((state) => state.setTtsVolume);
  const upsertCaption = useTranslatorStore((state) => state.upsertCaption);
  const updateCaptionTranslation = useTranslatorStore(
    (state) => state.updateCaptionTranslation
  );

  const publisherRef = useRef<ReturnType<typeof createCaptionPublisher> | null>(
    null
  );
  const partialGateRef = useRef(0);
  const chunkBufferRef = useRef(
    new Map<
      string,
      {
        chunks: string[];
        count: number;
      }
    >()
  );
  const prefsLoadedRef = useRef(false);

  const isPersonalRoom = !!searchParams.get("personal");
  const translatorIndicatorEnabled = captionsEnabled;

  const CallLayout = () => {
    switch (layout) {
      case "grid":
        return <PaginatedGridLayout />;
      case "speaker-right":
        return <SpeakerLayout participantsBarPosition="left" />;
      default:
        return <SpeakerLayout participantsBarPosition="right" />;
    }
  };

  useEffect(() => {
    if (!isLoaded || prefsLoadedRef.current) return;

    const prefs = (user?.unsafeMetadata as Record<string, unknown> | undefined)
      ?.translatorPrefs;
    if (prefs && typeof prefs === "object") {
      const data = prefs as Record<string, unknown>;

      if (typeof data.enabled === "boolean") setEnabled(data.enabled);
      if (typeof data.targetLang === "string" && data.targetLang) {
        setTargetLang(data.targetLang);
      }
      if (typeof data.showOriginal === "boolean") {
        setShowOriginal(data.showOriginal);
      }
      if (typeof data.speakerLang === "string" && data.speakerLang) {
        setSpeakerLang(data.speakerLang);
      }
      if (typeof data.ttsEnabled === "boolean") {
        setTtsEnabled(data.ttsEnabled);
      }
      if (typeof data.ttsVoice === "string") {
        setTtsVoice(data.ttsVoice);
      }
      if (typeof data.ttsVolume === "number") {
        setTtsVolume(data.ttsVolume);
      }
    }

    prefsLoadedRef.current = true;
  }, [
    isLoaded,
    user,
    setEnabled,
    setShowOriginal,
    setSpeakerLang,
    setTargetLang,
    setTtsEnabled,
    setTtsVoice,
    setTtsVolume,
  ]);

  useEffect(() => {
    if (callingState !== CallingState.JOINED) {
      publisherRef.current?.stop();
      publisherRef.current = null;
      return;
    }
    if (!call || !localParticipant?.userId) return;

    if (!captionsEnabled) {
      publisherRef.current?.stop();
      publisherRef.current = null;
      return;
    }

    const publisher = createCaptionPublisher({
      call,
      speakerUserId: localParticipant.userId,
      speakerName: localParticipant.name ?? localParticipant.userId,
      sourceLang: speakerLang,
    });

    publisherRef.current = publisher;
    publisher.start();

    return () => {
      publisher.stop();
      publisherRef.current = null;
    };
  }, [
    call,
    captionsEnabled,
    callingState,
    localParticipant?.userId,
    localParticipant?.name,
    speakerLang,
  ]);

  useEffect(() => {
    if (!call) return;

    const persistTranscript = async (caption: {
      utteranceId: string;
      speakerUserId: string;
      speakerName?: string;
      sourceLang: string;
      text: string;
      ts: number;
    }) => {
      try {
        await fetch("/api/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(caption),
        });
      } catch (error) {
        console.error("persistTranscript failed", error);
      }
    };


    const handleCaptionPayload = async (payload: {
      type?: string;
      v?: number;
      speakerUserId?: string;
      speakerName?: string;
      sourceLang?: string;
      text?: string;
      ts?: number;
      utteranceId?: string;
      chunkIndex?: number;
      chunkCount?: number;
    }) => {
      if (payload.v !== 1) return;
      if (payload.type !== "caption.partial" && payload.type !== "caption.final")
        return;
      if (!payload.utteranceId || !payload.speakerUserId) return;
      if (typeof payload.text !== "string") return;
      if (payload.text.length > MAX_EVENT_TEXT_LENGTH) return;

      if (payload.type === "caption.partial") {
        const now = Date.now();
        if (now - partialGateRef.current < PARTIAL_EVENT_THROTTLE_MS) return;
        partialGateRef.current = now;
      }

      let text = payload.text.trim();
      if (!text) return;

      if (
        typeof payload.chunkCount === "number" &&
        payload.chunkCount > 1 &&
        typeof payload.chunkIndex === "number"
      ) {
        const existing = chunkBufferRef.current.get(payload.utteranceId);
        const entry =
          existing ?? {
            chunks: new Array<string>(payload.chunkCount).fill(""),
            count: payload.chunkCount,
          };

        entry.chunks[payload.chunkIndex] = text;
        chunkBufferRef.current.set(payload.utteranceId, entry);

        if (entry.chunks.some((chunk) => !chunk)) return;

        text = entry.chunks.join("");
        chunkBufferRef.current.delete(payload.utteranceId);
      }

      const speakerName =
        payload.speakerName ||
        (payload.speakerUserId === localParticipant?.userId ? "You" : undefined);

      const caption = {
        utteranceId: payload.utteranceId,
        speakerUserId: payload.speakerUserId,
        speakerName,
        sourceLang: payload.sourceLang ?? "auto",
        text,
        isFinal: payload.type === "caption.final",
        ts: payload.ts ?? Date.now(),
      };

      upsertCaption(caption);

      if (caption.isFinal && meetingId) {
        try {
          const response = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: caption.text,
              sourceLang: caption.sourceLang,
              targetLang,
            }),
          });
          if (response.ok) {
            const data = (await response.json()) as { translatedText?: string };
            if (data.translatedText) {
              updateCaptionTranslation(
                caption.utteranceId,
                data.translatedText
              );
            }
          }
        } catch (error) {
          console.error("translate+persist failed", error);
        }
      }
    };

    const handleCustomEvent = (event: {
      custom?: unknown;
      payload?: unknown;
      data?: unknown;
    }) => {
      const raw = event.custom ?? event.payload ?? event.data ?? event;
      if (!raw || typeof raw !== "object") return;
      void handleCaptionPayload(raw as Record<string, unknown>);
    };

    const unsubscribe = call.on("custom", handleCustomEvent);

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [
    call,
    localParticipant?.userId,
    updateCaptionTranslation,
    upsertCaption,
    targetLang,
    meetingId,
  ]);

  useEffect(() => {
    if (!isTtsFeedEnabled || !meetingId) return;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/transcriptions/latest?meetingId=${encodeURIComponent(
            meetingId
          )}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          transcriptions?: Array<{
            id: string;
            text?: string;
            source_lang?: string;
          }>;
        };
        const latest = data.transcriptions?.[0];
        if (!latest) return;
        if (latest.id === lastTranslationIdRef.current) return;
        lastTranslationIdRef.current = latest.id;

        if (!latest.text) return;

        let textToSpeak = latest.text;

        if (targetLang && latest.source_lang && targetLang !== latest.source_lang) {
          try {
            const translateRes = await fetch("/api/translate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: latest.text,
                sourceLang: latest.source_lang ?? "auto",
                targetLang,
              }),
            });
            if (translateRes.ok) {
              const body = (await translateRes.json()) as {
                translatedText?: string;
              };
              textToSpeak = body.translatedText || textToSpeak;
            }
          } catch (error) {
            console.error("Translation for TTS failed", error);
          }
        }

        await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: textToSpeak,
            lang: targetLang,
          }),
        });
      } catch (error) {
        console.error("Failed to play saved translation", error);
      }
    };

    const interval = setInterval(() => {
      void poll();
    }, 4000);
    return () => clearInterval(interval);
  }, [isTtsFeedEnabled, meetingId, targetLang]);

  if (callingState !== CallingState.JOINED) return <Loader />;

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-white">
      {translatorIndicatorEnabled && (
        <div className="absolute left-4 top-4 z-40 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur-sm">
          {`Captions • ${targetLang.toUpperCase()}`}
        </div>
      )}

      <div className="relative flex size-full items-center justify-center px-4 pb-28 pt-4">
        <div className="flex size-full items-center">
          <CallLayout />
        </div>

        <div
          className={cn("ml-2 hidden h-[calc(100vh_-_120px)]", {
            "show-block": showParticipants,
          })}
        >
          <CallParticipantsList onClose={() => setShowParticipants(false)} />
        </div>
      </div>

      <CaptionsOverlay />
      <CaptionsTTS localUserId={localParticipant?.userId} />

      <div className="fixed bottom-0 left-0 right-0 z-50 flex w-full flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-black/80 px-3 py-3 backdrop-blur-md">
        <CallControls onLeave={() => router.push("/")} />

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(controlButtonClasses, "cursor-pointer")}
            title="Call layout"
          >
            <LayoutList size={20} className="text-white" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="border-white/10 bg-black/90 text-white">
            {["Grid", "Speaker Left", "Speaker Right"].map((item, i) => (
              <div key={item + "-" + i}>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() =>
                    setLayout(
                      item.toLowerCase().replace(" ", "-") as CallLayoutType
                    )
                  }
                >
                  {item}
                </DropdownMenuItem>

                <DropdownMenuSeparator className="border-white/10" />
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={() => setIsTranslatorOpen(true)}
          title="Live Translator"
        >
          <div
            className={cn(
              "relative cursor-pointer",
              controlButtonClasses,
              captionsEnabled
                ? "bg-emerald-500/80 hover:bg-emerald-500"
                : "bg-white/5 hover:bg-white/15"
            )}
          >
            <Languages size={20} className="text-white" />
            {captionsEnabled && (
              <span className="absolute -right-1 -top-1 rounded-full bg-white px-1 text-[10px] font-bold text-black">
                CC
              </span>
            )}
          </div>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(controlButtonClasses, "cursor-pointer")}
            title="Translation language"
          >
            <Volume2 size={20} className="text-white" />
            <span className="ml-1 text-xs font-semibold">Lang</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="border-white/10 bg-black/90 text-white max-h-64 overflow-y-auto">
            {TARGET_LANGUAGES.map((option) => (
              <DropdownMenuItem
                key={option.value}
                className="cursor-pointer"
                onClick={() => setTargetLang(option.value)}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={() => setIsTtsFeedEnabled((prev) => !prev)}
          title="Translator TTS (Supabase feed)"
        >
          <div
            className={cn(
              controlButtonClasses,
              "cursor-pointer",
              isTtsFeedEnabled
                ? "bg-emerald-500/80 hover:bg-emerald-500"
                : "bg-white/5 hover:bg-white/15"
            )}
          >
            <Volume2 size={20} className="text-white" />
            <span className="ml-2 text-xs font-semibold">Translator</span>
          </div>
        </button>

        <CallStatsButton />

        <button
          onClick={() =>
            setShowParticipants((prevShowParticipants) => !prevShowParticipants)
          }
          title="Show participants"
        >
          <div className={cn(controlButtonClasses, "cursor-pointer")}>
            <Users size={20} className="text-white" />
          </div>
        </button>

        {!isPersonalRoom && <EndCallButton />}
      </div>

      <TranslatorModal
        open={isTranslatorOpen}
        onOpenChange={setIsTranslatorOpen}
      />
    </div>
  );
};
