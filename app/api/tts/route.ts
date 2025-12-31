import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const MAX_TEXT_LENGTH = 600;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;

const rateLimit = new Map<string, { count: number; windowStart: number }>();

const checkRateLimit = (userId: string) => {
  const now = Date.now();
  const entry = rateLimit.get(userId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimit.set(userId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count += 1;
  rateLimit.set(userId, entry);
  return true;
};

export async function POST(req: Request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(userId)) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 }
    );
  }

  let payload: { text?: string; voice?: string; lang?: string };
  try {
    payload = (await req.json()) as {
      text?: string;
      voice?: string;
      lang?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = payload.text?.trim() ?? "";
  const voice = payload.voice?.trim();
  const lang = payload.lang?.trim();

  if (!text) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "Text too long" }, { status: 413 });
  }

  const cartesiaKey = process.env.CARTESIA_API_KEY;
  if (!cartesiaKey) {
    return NextResponse.json(
      { error: "Cartesia API key is not configured" },
      { status: 500 }
    );
  }

  const modelId = process.env.CARTESIA_TTS_MODEL_ID || "sonic-3";
  const voiceId =
    voice || process.env.CARTESIA_TTS_VOICE_ID || "9c7e6604-52c6-424a-9f9f-2c4ad89f3bb9";

  const requestPayload = {
    model_id: modelId,
    transcript: text,
    voice: {
      mode: "id",
      id: voiceId,
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
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "Cartesia-Version": "2025-04-16",
        "X-API-Key": cartesiaKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Cartesia TTS failed", response.status, errorText);
      return NextResponse.json(
        { error: "TTS request failed" },
        { status: 502 }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = "audio/wav";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TTS failed";
    console.error("Cartesia TTS error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
