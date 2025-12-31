import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { TARGET_LANGUAGES } from "@/constants/languages";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MAX_TEXT_LENGTH = 1000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const CACHE_MAX_ENTRIES = 200;

const rateLimit = new Map<string, { count: number; windowStart: number }>();
const cache = new Map<string, { value: string; ts: number }>();

const persistTranslation = async ({
  userId,
  sourceLang,
  targetLang,
  originalText,
  translatedText,
}: {
  userId: string;
  sourceLang: string;
  targetLang: string;
  originalText: string;
  translatedText: string;
}) => {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) return;
    await supabase.from("translations").insert({
      user_id: userId,
      source_lang: sourceLang,
      target_lang: targetLang,
      original_text: originalText,
      translated_text: translatedText,
    });
  } catch (error) {
    console.error("Translation API: failed to persist translation", error);
  }
};

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

  const tryGoogleFree = async () => {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        sourceLang
      )}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(
        text
      )}`;
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as [Array<[string]>];
      const translatedText =
        data?.[0]?.map((entry) => entry[0]).join("") ?? "";
      if (!translatedText) return null;
      return translatedText;
    } catch (error) {
      console.error("Translation API: Google free translate failed", error);
      return null;
    }
  };

  const tryOllama = async () => {
    const apiKey = process.env.OLLAMA_API_KEY;
    const apiUrl =
      process.env.OLLAMA_API_URL || "https://ollama.com/api/chat";
    const model = process.env.OLLAMA_MODEL || "gpt-oss:120b-cloud";
    const fallbackModel = "gpt-oss:120b-cloud";
    if (!apiKey) return null;

    const sourceName =
      TARGET_LANGUAGES.find((l) => l.value === sourceLang)?.label || sourceLang;
    const targetName =
      TARGET_LANGUAGES.find((l) => l.value === targetLang)?.label || targetLang;

    const prompt = `Translate the text below from ${
      sourceLang === "auto" ? "the detected language" : sourceName
    } to ${targetName}. Return only the translation, nothing else.\n\nText:\n${text}`;

    const runOnce = async (modelName: string) => {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            stream: true,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Translation API: Ollama error", {
            status: response.status,
            errorText,
            model: modelName,
          });
          return { ok: false as const, status: response.status };
        }

        const reader = response.body?.getReader();
        if (!reader) return { ok: false as const, status: 0 };

        const decoder = new TextDecoder();
        let buffer = "";
        let output = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const json = JSON.parse(trimmed) as {
                message?: { content?: string };
                done?: boolean;
              };
              if (json.message?.content) {
                output += json.message.content;
              }
              if (json.done) {
                buffer = "";
                break;
              }
            } catch {
              // ignore malformed partials
            }
          }
        }

        if (!output.trim()) return { ok: false as const, status: 200 };
        return { ok: true as const, text: output.trim() };
      } catch (error) {
        console.error("Translation API: Ollama fetch failed", error);
        return { ok: false as const, status: 0 };
      }
    };

    const first = await runOnce(model);
    if (first.ok) return first.text;
    if (first.status === 404 && model !== fallbackModel) {
      const retry = await runOnce(fallbackModel);
      if (retry.ok) return retry.text;
    }
    return null;
  };

  const ollamaResult = await tryOllama();
  if (ollamaResult) {
    void persistTranslation({
      userId,
      sourceLang,
      targetLang,
      originalText: text,
      translatedText: ollamaResult,
    });
    cache.set(cacheKey, { value: ollamaResult, ts: Date.now() });
    pruneCache();
    return NextResponse.json({ translatedText: ollamaResult });
  }

  const googleResult = await tryGoogleFree();
  if (googleResult) {
    void persistTranslation({
      userId,
      sourceLang,
      targetLang,
      originalText: text,
      translatedText: googleResult,
    });
    cache.set(cacheKey, { value: googleResult, ts: Date.now() });
    pruneCache();
    return NextResponse.json({ translatedText: googleResult });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return NextResponse.json(
      { error: "Translation unavailable" },
      { status: 502 }
    );
  }

  const model =
    process.env.GEMINI_TRANSLATE_MODEL ?? "gemini-flash-lite-latest";
  const primaryModel = model.startsWith("models/")
    ? model
    : `models/${model}`;
  const fallbackModel = "models/gemini-flash-latest-lite";

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

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    };

    const tryTranslate = async (modelPath: string) => {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Translation API: Gemini error", {
          status: response.status,
          modelPath,
          errorText,
        });
        return { ok: false as const, errorText };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };

      return { ok: true as const, data };
    };

    let result = await tryTranslate(primaryModel);
    if (!result.ok && primaryModel !== fallbackModel) {
      result = await tryTranslate(fallbackModel);
    }

    if (!result.ok) {
      return NextResponse.json(
        { error: "Translation failed" },
        { status: 502 }
      );
    }

    const data = result.data;

  const translatedText =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

  console.log("Translation API: Result", { translatedText });

  if (!translatedText) {
    return NextResponse.json(
      { error: "Translation unavailable" },
      { status: 502 }
    );
  }

  void persistTranslation({
    userId,
    sourceLang,
    targetLang,
    originalText: text,
    translatedText,
  });
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
