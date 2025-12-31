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
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CaptionsOverlay } from "@/components/translator/captions-overlay";
import { TranslatorModal } from "@/components/translator/translator-modal";
import { createCaptionPublisher } from "@/lib/translator/captions/publisher";
import { cn } from "@/lib/utils";
import { useTranslatorStore } from "@/store/use-translator";

import { EndCallButton } from "./end-call-button";
import { Loader } from "./loader";

type CallLayoutType = "grid" | "speaker-left" | "speaker-right";
const MAX_EVENT_TEXT_LENGTH = 4000;
const PARTIAL_EVENT_THROTTLE_MS = 100;

export const MeetingRoom = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showParticipants, setShowParticipants] = useState(false);
  const [layout, setLayout] = useState<CallLayoutType>("speaker-left");
  const [isTranslatorOpen, setIsTranslatorOpen] = useState(false);

  const call = useCall();

  const { useCallCallingState, useLocalParticipant } = useCallStateHooks();
  const callingState = useCallCallingState();
  const localParticipant = useLocalParticipant();

  const captionsEnabled = useTranslatorStore((state) => state.enabled);
  const autoTranslateEnabled = useTranslatorStore(
    (state) => state.autoTranslateEnabled
  );
  const targetLang = useTranslatorStore((state) => state.targetLang);
  const speakerLang = useTranslatorStore((state) => state.speakerLang);
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
  const inflightTranslationRef = useRef(new Set<string>());

  const isPersonalRoom = !!searchParams.get("personal");
  const translatorIndicatorEnabled = captionsEnabled || autoTranslateEnabled;

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
      speakerName: localParticipant.user?.name ?? localParticipant.userId,
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
    localParticipant?.user?.name,
    speakerLang,
  ]);

  useEffect(() => {
    if (!call) return;

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
            chunks: Array.from({ length: payload.chunkCount }).fill(""),
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

      if (!caption.isFinal) return;

      const { autoTranslateEnabled: autoTranslate, targetLang: target } =
        useTranslatorStore.getState();
      if (!autoTranslate || !target || target === caption.sourceLang) return;
      if (inflightTranslationRef.current.has(caption.utteranceId)) return;

      inflightTranslationRef.current.add(caption.utteranceId);

      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: caption.text,
            sourceLang: caption.sourceLang,
            targetLang: target,
          }),
        });

        if (!response.ok) return;

        const data = (await response.json()) as { translatedText?: string };
        if (!data.translatedText) return;

        updateCaptionTranslation(caption.utteranceId, data.translatedText);
      } finally {
        inflightTranslationRef.current.delete(caption.utteranceId);
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
  }, [call, localParticipant?.userId, updateCaptionTranslation, upsertCaption]);

  if (callingState !== CallingState.JOINED) return <Loader />;

  return (
    <div className="relative h-screen w-full overflow-hidden pt-4 text-white">
      {translatorIndicatorEnabled && (
        <div className="absolute left-4 top-4 z-40 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur-sm">
          {autoTranslateEnabled
            ? `CC • ${targetLang.toUpperCase()}`
            : "Captions On"}
        </div>
      )}

      <div className="relative flex size-full items-center justify-center">
        <div className="flex size-full max-w-[1000px] items-center">
          <CallLayout />
        </div>

        <div
          className={cn("ml-2 hidden h-[calc(100vh_-_86px)]", {
            "show-block": showParticipants,
          })}
        >
          <CallParticipantsList onClose={() => setShowParticipants(false)} />
        </div>
      </div>

      <CaptionsOverlay />

      <div className="fixed bottom-0 flex w-full flex-wrap items-center justify-center gap-5">
        <CallControls onLeave={() => router.push("/")} />

        <DropdownMenu>
          <div className="flex items-center">
            <DropdownMenuTrigger
              className="cursor-pointer rounded-2xl bg-[#19232D] px-4 py-2 hover:bg-[#4C535B]"
              title="Call layout"
            >
              <LayoutList size={20} className="text-white" />
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuContent className="border-dark-1 bg-dark-1 text-white">
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

                <DropdownMenuSeparator className="border-dark-1" />
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
              "relative cursor-pointer rounded-2xl px-4 py-2 transition-colors",
              captionsEnabled
                ? "bg-emerald-500/80 hover:bg-emerald-500"
                : "bg-[#19232D] hover:bg-[#4C535B]"
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

        <CallStatsButton />

        <button
          onClick={() =>
            setShowParticipants((prevShowParticipants) => !prevShowParticipants)
          }
          title="Show participants"
        >
          <div className="cursor-pointer rounded-2xl bg-[#19232D] px-4 py-2 hover:bg-[#4C535B]">
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
