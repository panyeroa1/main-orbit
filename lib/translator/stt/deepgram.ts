import type { SpeechToTextOptions, SpeechToTextProvider } from "./index";

// Minimal Deepgram realtime STT using browser WebSocket + mic capture.
// Requires NEXT_PUBLIC_DEEPGRAM_API_KEY to be set (exposed to client for MVP).
export const createDeepgramSTT = (
  options: SpeechToTextOptions
): SpeechToTextProvider => {
  let mediaStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let socket: WebSocket | null = null;
  let active = false;

  const cleanup = () => {
    socket?.close();
    socket = null;
    processor?.disconnect();
    processor = null;
    audioCtx?.close();
    audioCtx = null;
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  };

  const stop = () => {
    active = false;
    cleanup();
  };

  const start = async () => {
    if (active) return;
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
    if (!apiKey) {
      options.onError?.(new Error("Deepgram API key not configured"));
      return;
    }

    active = true;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      const source = audioCtx.createMediaStreamSource(mediaStream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);

      const language = options.lang && options.lang !== "auto" ? options.lang : "en";
      const url = `wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&language=${encodeURIComponent(
        language
      )}&encoding=linear16&sample_rate=16000&apikey=${encodeURIComponent(apiKey)}`;

      socket = new WebSocket(url);

      socket.onopen = () => {
        if (!processor || !source || !audioCtx) return;
        processor.onaudioprocess = (event) => {
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          const inputData = event.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i += 1) {
            pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
          }
          socket.send(pcm16);
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const transcript =
            data.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
          const isFinal = Boolean(data.is_final);
          if (!transcript) return;
          options.onResult({ text: transcript, isFinal });
        } catch (error) {
          options.onError?.(error as Error);
        }
      };

      socket.onerror = () => {
        options.onError?.(new Error("Deepgram socket error"));
        stop();
      };
      socket.onclose = () => {
        if (active) {
          options.onError?.(new Error("Deepgram socket closed"));
        }
        stop();
      };
    } catch (error) {
      options.onError?.(error as Error);
      stop();
    }
  };

  const setLanguage = (lang: string) => {
    // Restart with new language
    if (!active) return;
    stop();
    options.lang = lang;
    void start();
  };

  return { start, stop, setLanguage };
};
