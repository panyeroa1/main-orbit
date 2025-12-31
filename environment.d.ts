// This file is needed to support autocomplete for process.env
export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // stream api keys
      NEXT_PUBLIC_STREAM_API_KEY: string;
      STREAM_SECRET_KEY: string;

      // app base url
      NEXT_PUBLIC_BASE_URL: string;

      // live translator
      GOOGLE_FREE_TRANSLATE?: string;
      CARTESIA_API_KEY?: string;
      CARTESIA_TTS_MODEL_ID?: string;
      CARTESIA_TTS_VOICE_ID?: string;
      NEXT_PUBLIC_DEEPGRAM_API_KEY?: string;
      OLLAMA_API_KEY?: string;
      OLLAMA_API_URL?: string;
      OLLAMA_MODEL?: string;
      SUPABASE_URL?: string;
      SUPABASE_KEY?: string;
    }
  }
}
