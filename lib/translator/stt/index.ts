export type TranscriptResult = {
  text: string;
  isFinal: boolean;
};

export type SpeechToTextOptions = {
  onResult: (result: TranscriptResult) => void;
  onError?: (error: Error) => void;
  lang?: string;
};

export type SpeechToTextProvider = {
  start: () => void;
  stop: () => void;
  setLanguage?: (lang: string) => void;
};
