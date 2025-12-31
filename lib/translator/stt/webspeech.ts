import type { SpeechToTextOptions, SpeechToTextProvider } from "./index";

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const getSpeechRecognitionConstructor = () => {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition || window.webkitSpeechRecognition;
};

export const createWebSpeechSTT = (
  options: SpeechToTextOptions
): SpeechToTextProvider => {
  let recognition: SpeechRecognitionInstance | null = null;
  let shouldRestart = false;

  const handleResult = (event: any) => {
    let transcript = "";
    let isFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";

      transcript += text;
      if (result.isFinal) isFinal = true;
    }

    const trimmed = transcript.trim();
    if (!trimmed) return;

    options.onResult({ text: trimmed, isFinal });
  };

  const start = () => {
    const RecognitionConstructor = getSpeechRecognitionConstructor();
    if (!RecognitionConstructor) {
      options.onError?.(new Error("Speech recognition is not supported."));
      return;
    }

    recognition?.stop();
    recognition = new RecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;

    if (options.lang && options.lang !== "auto") {
      recognition.lang = options.lang;
    }

    recognition.onresult = handleResult;
    recognition.onerror = (event) => {
      options.onError?.(
        new Error(event.error || "Speech recognition error.")
      );
    };
    recognition.onend = () => {
      if (shouldRestart) recognition?.start();
    };

    shouldRestart = true;
    recognition.start();
  };

  const stop = () => {
    shouldRestart = false;
    recognition?.stop();
    recognition = null;
  };

  const setLanguage = (lang: string) => {
    if (recognition && lang && lang !== "auto") {
      recognition.lang = lang;
    }
  };

  return { start, stop, setLanguage };
};
