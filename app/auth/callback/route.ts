import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileLinked } from "@/lib/auth/profile";

/** OAuth (Google) redirect lands here: exchange the code for a session, link the profile, then continue. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  // only allow internal (same-site) redirect targets
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (code) {
    const supabase = await createClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        await ensureProfileLinked();
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
