import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const MAX_TEXT_LENGTH = 1000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const CACHE_MAX_ENTRIES = 200;

const rateLimit = new Map<string, { count: number; windowStart: number }>();
const cache = new Map<string, { value: string; ts: number }>();

const pruneCache = () => {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const overflow = cache.size - CACHE_MAX_ENTRIES;
  for (let i = 0; i < overflow; i += 1) {
    cache.delete(entries[i][0]);
  }
};

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

  let payload: { text?: string; sourceLang?: string; targetLang?: string };
  try {
    payload = (await req.json()) as {
      text?: string;
      sourceLang?: string;
      targetLang?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = payload.text?.trim() ?? "";
  const sourceLang = payload.sourceLang?.trim() || "auto";
  const targetLang = payload.targetLang?.trim() ?? "";

  if (!text || !targetLang) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "Text too long" }, { status: 413 });
  }

  if (sourceLang === targetLang) {
    return NextResponse.json({ translatedText: text });
  }

  const cacheKey = `${sourceLang}:${targetLang}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ translatedText: cached.value });
  }

  const apiUrl = process.env.TRANSLATE_API_URL;
  if (!apiUrl) {
    return NextResponse.json({ translatedText: text });
  }

  const apiKey = process.env.TRANSLATE_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        q: text,
        source: sourceLang,
        target: targetLang,
        format: "text",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Translation failed" },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      translatedText?: string;
      translation?: string;
      result?: string;
      data?: { translations?: Array<{ translatedText?: string }> };
    };

    const translatedText =
      data.translatedText ??
      data.translation ??
      data.result ??
      data.data?.translations?.[0]?.translatedText;

    if (!translatedText) {
      return NextResponse.json(
        { error: "Translation unavailable" },
        { status: 502 }
      );
    }

    cache.set(cacheKey, { value: translatedText, ts: Date.now() });
    pruneCache();

    return NextResponse.json({ translatedText });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Translation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
