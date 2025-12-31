import type { SpeechToTextOptions, SpeechToTextProvider } from "./index";

export const createRemoteSTT = (
  _options: SpeechToTextOptions
): SpeechToTextProvider => {
  return {
    start: () => {
      throw new Error("Remote STT provider is not configured.");
    },
    stop: () => {},
  };
};
