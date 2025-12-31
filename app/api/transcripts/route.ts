import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

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
    utteranceId?: string;
    speakerUserId?: string;
    speakerName?: string;
    sourceLang?: string;
    text?: string;
    ts?: number;
    meetingId?: string;
  };

  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.utteranceId || !payload.speakerUserId || !payload.text) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { error } = await supabase.from("transcriptions").insert({
    user_id: userId,
    room_name: payload.meetingId ?? "",
    sender: payload.speakerName || payload.speakerUserId,
    text: payload.text,
    created_at: new Date(payload.ts ?? Date.now()).toISOString(),
  });

  if (error) {
    console.error("Supabase insert failed", error);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
