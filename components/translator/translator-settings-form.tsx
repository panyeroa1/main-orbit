"use client";

import { useTranslatorStore } from "@/store/use-translator";

const TARGET_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "tl", label: "Tagalog" },
];

const SPEAKER_LANGUAGES = [
  { value: "auto", label: "Auto detect" },
  ...TARGET_LANGUAGES,
];

export const TranslatorSettingsForm = () => {
  const enabled = useTranslatorStore((state) => state.enabled);
  const autoTranslateEnabled = useTranslatorStore(
    (state) => state.autoTranslateEnabled
  );
  const targetLang = useTranslatorStore((state) => state.targetLang);
  const showOriginal = useTranslatorStore((state) => state.showOriginal);
  const speakerLang = useTranslatorStore((state) => state.speakerLang);
  const setEnabled = useTranslatorStore((state) => state.setEnabled);
  const setAutoTranslateEnabled = useTranslatorStore(
    (state) => state.setAutoTranslateEnabled
  );
  const setTargetLang = useTranslatorStore((state) => state.setTargetLang);
  const setShowOriginal = useTranslatorStore((state) => state.setShowOriginal);
  const setSpeakerLang = useTranslatorStore((state) => state.setSpeakerLang);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0F1720] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-white">
            Enable Live Captions
          </p>
          <p className="text-xs text-white/60">
            Broadcast your speech as captions to the call.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-5 accent-emerald-500"
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0F1720] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-white">
            Auto-translate captions
          </p>
          <p className="text-xs text-white/60">
            Translate incoming captions to your target language.
          </p>
        </div>
        <input
          type="checkbox"
          checked={autoTranslateEnabled}
          onChange={(event) => setAutoTranslateEnabled(event.target.checked)}
          className="size-5 accent-sky-500"
        />
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0F1720] px-4 py-3">
        <label className="text-sm font-semibold text-white">
          My target language
        </label>
        <select
          value={targetLang}
          onChange={(event) => setTargetLang(event.target.value)}
          className="mt-2 w-full rounded-lg border border-white/10 bg-[#101b24] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/60"
        >
          {TARGET_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0F1720] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-white">Show original text</p>
          <p className="text-xs text-white/60">
            Display the original caption under the translation.
          </p>
        </div>
        <input
          type="checkbox"
          checked={showOriginal}
          onChange={(event) => setShowOriginal(event.target.checked)}
          className="size-5 accent-amber-500"
        />
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0F1720] px-4 py-3">
        <label className="text-sm font-semibold text-white">
          Speaker language
        </label>
        <select
          value={speakerLang}
          onChange={(event) => setSpeakerLang(event.target.value)}
          className="mt-2 w-full rounded-lg border border-white/10 bg-[#101b24] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
        >
          {SPEAKER_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
