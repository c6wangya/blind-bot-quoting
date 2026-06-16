import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyHandoffToken } from "@/lib/auth/blindbot-handoff";
import { BRAND } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { ConsentContinueButton } from "@/components/HandoffActions";
import { Card } from "@/components/ui";

const safeNext = (n: string | undefined) =>
  n && n.startsWith("/") && !n.startsWith("//") ? n : "/";

const initial = (email: string) => (email.trim()[0] ?? "?").toUpperCase();

/** A chevron, like Google's account chooser rows. */
function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4 shrink-0 text-muted" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * Landing for a verified blind-bot "Get a quote" handoff. Runs as a SAME-ORIGIN GET so it
 * can read quote's session cookie (the cross-site POST to /api/handoff cannot). Decides:
 *   - no session                → /login (carry design)
 *   - same account, first time  → one-time consent ("entering a separate service"), remembered
 *   - same account, consented   → straight through (silent)
 *   - different account         → account chooser (continue as / switch)
 */
export default async function HandoffChoosePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; token?: string }>;
}) {
  const { next: rawNext, token } = await searchParams;
  const next = safeNext(rawNext);

  const blindbotEmail = token ? verifyHandoffToken(token) : null;
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  const sessionEmail = user?.email ?? null;

  if (!token || !blindbotEmail) redirect(next);
  if (!sessionEmail) redirect(`/login?next=${encodeURIComponent(next)}`);

  const sameAccount = sessionEmail.toLowerCase() === blindbotEmail!.toLowerCase();

  // ---- same account ----
  if (sameAccount) {
    const consented = user?.user_metadata?.bb_handoff_consented === true;
    if (consented) redirect(next); // remembered → silent pass-through

    // First time: one-time "you're entering a separate service" consent.
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md px-7 py-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Continue to {BRAND.name}?</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            <span className="font-medium text-ink-soft">{BRAND.name}</span> is a separate quoting
            service. We’ll bring your BlindBot design over and sign you in as{" "}
            <span className="font-medium text-ink">{sessionEmail}</span>.
          </p>
          <div className="mt-4 rounded-xl bg-[#f1efe9] px-4 py-3 text-left text-[12.5px] text-ink-soft">
            Your BlindBot password is never shared. You’ll only see this once.
          </div>
          <div className="mt-6">
            <ConsentContinueButton next={next} brand={BRAND.name} />
          </div>
        </Card>
      </div>
    );
  }

  // ---- different account → account chooser (Google "Choose an account" pattern) ----
  const switchHref = `/api/handoff/callback?token=${encodeURIComponent(token!)}&next=${encodeURIComponent(next)}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f5f1] p-6">
      <Card className="w-full max-w-md px-0 py-0 overflow-hidden">
        <div className="px-8 pb-6 pt-9 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brass to-[#8a6a39] text-base font-bold text-white shadow-md">
            {BRAND.monogram}
          </div>
          <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">Choose an account</h1>
          <p className="mt-1 text-[13px] text-muted">
            to continue to <span className="font-medium text-ink-soft">{BRAND.name}</span>
          </p>
        </div>

        <div className="border-t border-line">
          {/* current quote account */}
          <Link href={next} className="flex items-center gap-3.5 px-7 py-4 transition-colors hover:bg-[#faf9f5]">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5b6b8f] to-[#3a4763] text-sm font-semibold text-white">
              {initial(sessionEmail)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-ink">{sessionEmail}</div>
              <div className="text-[11.5px] text-muted">Your current {BRAND.name} account</div>
            </div>
            <Chevron />
          </Link>

          {/* the blind-bot identity */}
          <Link href={switchHref} className="flex items-center gap-3.5 border-t border-line/70 px-7 py-4 transition-colors hover:bg-[#faf9f5]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/blindbot-icon.png" alt="" className="size-9 shrink-0 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-ink">{blindbotEmail}</div>
              <div className="text-[11.5px] text-muted">From BlindBot · sign in here</div>
            </div>
            <Chevron />
          </Link>
        </div>

        <p className="border-t border-line bg-[#fafaf7] px-7 py-4 text-center text-[11px] leading-relaxed text-muted">
          {BRAND.name} is a separate service. Your BlindBot password is never shared.
        </p>
      </Card>
    </div>
  );
}
