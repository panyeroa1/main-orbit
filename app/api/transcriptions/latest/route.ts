import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
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

  const { searchParams } = new URL(req.url);
  const meetingId = searchParams.get("meetingId") || undefined;

  if (!meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("transcriptions")
    .select("id, text, created_at")
    .eq("room_name", meetingId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Latest transcription fetch failed", error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }

  return NextResponse.json({ transcriptions: data ?? [] });
}
