import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { TARGET_LANGUAGES } from "@/constants/languages";

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
    console.log("Translation API: Invalid input", { text, targetLang });
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  console.log("Translation API: Request", { sourceLang, targetLang, textLength: text.length });

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "Text too long" }, { status: 413 });
  }


  const cacheKey = `${sourceLang}:${targetLang}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return NextResponse.json({ translatedText: cached.value });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return NextResponse.json(
      { error: "Gemini API key is not configured" },
      { status: 500 }
    );
  }

  const model = process.env.GEMINI_TRANSLATE_MODEL ?? "gemini-flash-latest-lite";
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const sourceName = TARGET_LANGUAGES.find(l => l.value === sourceLang)?.label || sourceLang;
    const targetName = TARGET_LANGUAGES.find(l => l.value === targetLang)?.label || targetLang;

    const prompt = `You are a professional real-time translator. Translate the following text from ${
      sourceLang === "auto" ? "the automatically detected language" : sourceName
    } to ${targetName}. 
    
    IMPORTANT:
    - Return ONLY the translated text.
    - Do not include any explanations or punctuation outside what is necessary for the translation.
    - If the source and target are the same basic language but different dialects, adapt the text to the target dialect.
    
    Text to translate:
    ${text}`;
    
    console.log("Translation API: Prompt created", { sourceName, targetName });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Translation failed" },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const translatedText =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    console.log("Translation API: Result", { translatedText });

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
