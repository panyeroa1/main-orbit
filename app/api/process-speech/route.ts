import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:120b-cloud";
const OLLAMA_API_URL =
  process.env.OLLAMA_API_URL || "https://ollama.com/api/chat";

const CARTESIA_ENDPOINT = "https://api.cartesia.ai/tts/bytes";

const PUNCTUATION_REGEX = /[\\.!?;,]+/;

export async function POST(req: Request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 500 }
    );
  }

  let payload: {
    text?: string;
    sourceLang?: string;
    targetLang?: string;
    meetingId?: string;
    sender?: string;
  };

  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = payload.text?.trim() || "";
  const sourceLang = payload.sourceLang?.trim() || "auto";
  const targetLang = payload.targetLang?.trim() || "en";
  const meetingId = payload.meetingId?.trim();
  const sender = payload.sender?.trim();

  if (!text) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Insert transcription (await to get ID)
  const { data: transcriptionData, error: transcriptionError } = await supabase
    .from("transcriptions")
    .insert({
      user_id: userId,
      room_name: meetingId ?? "unknown",
      sender: sender || userId,
      text,
      source_lang: sourceLang,
    })
    .select("id")
    .single();

  const transcriptionId =
    transcriptionError || !transcriptionData ? null : transcriptionData.id;

  const cartesiaKey = process.env.CARTESIA_API_KEY;
  if (!cartesiaKey) {
    return NextResponse.json(
      { error: "Cartesia API key missing" },
      { status: 500 }
    );
  }

  const ollamaKey = process.env.OLLAMA_API_KEY;
  if (!ollamaKey) {
    return NextResponse.json(
      { error: "Ollama API key missing" },
      { status: 500 }
    );
  }

  const controller = new AbortController();

  const stream = new ReadableStream({
    async start(streamController) {
      let fullTranslation = "";
      let buffer = "";

      const flushPhrase = async (phrase: string) => {
        if (!phrase.trim()) return;
        try {
          const ttsRes = await fetch(CARTESIA_ENDPOINT, {
            method: "POST",
            headers: {
              "Cartesia-Version": "2025-04-16",
              "X-API-Key": cartesiaKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model_id: process.env.CARTESIA_TTS_MODEL_ID || "sonic-3",
              transcript: phrase,
              voice: {
                mode: "id",
                id:
                  process.env.CARTESIA_TTS_VOICE_ID ||
                  "9c7e6604-52c6-424a-9f9f-2c4ad89f3bb9",
              },
              output_format: {
                container: "wav",
                encoding: "pcm_f32le",
                sample_rate: 44100,
              },
              speed: "normal",
              generation_config: {
                speed: 1,
                volume: 1,
              },
              ...(targetLang ? { language: targetLang } : {}),
            }),
            signal: controller.signal,
          });

          if (!ttsRes.ok || !ttsRes.body) return;
          const reader = ttsRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) streamController.enqueue(value);
          }
        } catch (error) {
          console.error("Cartesia TTS failed", error);
        }
      };

      try {
        const ollamaRes = await fetch(OLLAMA_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ollamaKey}`,
          },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: true,
            messages: [
              {
                role: "user",
                content: `You are a real-time translator. Translate the following text from ${sourceLang} to ${targetLang}. Do not add preamble. Output only the translation.\n\nText:\n${text}`,
              },
            ],
            temperature: 0.2,
          }),
          signal: controller.signal,
        });

        if (!ollamaRes.ok || !ollamaRes.body) {
          streamController.close();
          return;
        }

        const decoder = new TextDecoder();
        const reader = ollamaRes.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const json = JSON.parse(line) as {
                message?: { content?: string };
              };
              const content = json.message?.content || "";
              if (!content) continue;
              fullTranslation += content;
              buffer += content;
              if (PUNCTUATION_REGEX.test(buffer)) {
                const parts = buffer.split(PUNCTUATION_REGEX);
                // send all complete phrases except last remainder
                for (let i = 0; i < parts.length - 1; i += 1) {
                  void flushPhrase(parts[i]);
                }
                buffer = parts[parts.length - 1];
              }
            } catch {
              // ignore malformed lines
            }
          }
        }

        if (buffer.trim()) {
          await flushPhrase(buffer);
        }

        if (fullTranslation.trim()) {
          void supabase.from("translations").insert({
            user_id: userId,
            source_lang: sourceLang,
            target_lang: targetLang,
            original_text: text,
            translated_text: fullTranslation.trim(),
          });
        }
      } catch (error) {
        console.error("process-speech error", error);
      } finally {
        streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Transfer-Encoding": "chunked",
    },
  });
}
