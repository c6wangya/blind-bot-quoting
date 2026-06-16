import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyHandoffToken } from "@/lib/auth/blindbot-handoff";
import { BRAND } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";

const safeNext = (n: string | undefined) =>
  n && n.startsWith("/") && !n.startsWith("//") ? n : "/";

/**
 * Account chooser shown when a blind-bot "Get a quote" handoff arrives but the quote
 * session belongs to a DIFFERENT account than the blind-bot user (account mismatch).
 * Mirrors the Google/GitHub "Continue as X / switch account" pattern — we name both
 * accounts and never silently proceed.
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
  const sessionEmail = supabase ? (await supabase.auth.getUser()).data.user?.email ?? null : null;

  // Nothing to choose between → fall back sensibly.
  if (!token || !blindbotEmail) redirect(next);
  if (!sessionEmail) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (sessionEmail.toLowerCase() === blindbotEmail!.toLowerCase()) redirect(next);

  const switchHref = `/api/handoff/callback?token=${encodeURIComponent(token!)}&next=${encodeURIComponent(next)}`;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md px-7 py-8">
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Which account?</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            You came from <span className="font-medium text-ink-soft">BlindBot</span> as{" "}
            <span className="font-medium text-ink">{blindbotEmail}</span>, but you’re signed in to{" "}
            <span className="font-medium text-ink-soft">{BRAND.name}</span> as a different account.
            How would you like to continue?
          </p>
        </div>

        <div className="mt-6 space-y-3">
          {/* Continue as the current quote account */}
          <Link
            href={next}
            className="block rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-[#cfcabd] hover:bg-[#faf9f5]"
          >
            <div className="text-[13px] font-semibold text-ink">Continue as {sessionEmail}</div>
            <div className="mt-0.5 text-[11.5px] text-muted">Your current {BRAND.name} account</div>
          </Link>

          {/* Switch to the blind-bot identity (completes the verified handoff) */}
          <Link
            href={switchHref}
            className="block rounded-xl bg-ink px-4 py-3 text-white shadow-sm transition-colors hover:bg-[#2a3756]"
          >
            <div className="text-[13px] font-semibold">Switch to {blindbotEmail}</div>
            <div className="mt-0.5 text-[11.5px] text-white/60">Use your BlindBot account here</div>
          </Link>
        </div>

        <p className="mt-5 text-center text-[11px] text-muted">
          {BRAND.name} is a separate service. Switching signs you in here with your BlindBot email; your
          BlindBot password is never shared.
        </p>
      </Card>
    </div>
  );
}
