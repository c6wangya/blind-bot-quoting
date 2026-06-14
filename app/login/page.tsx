import Link from "next/link";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import SignOutButton from "@/components/SignOutButton";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const ERROR_MESSAGES: Record<string, string> = {
  auth: "Sign-in failed. Please try again.",
};

/** Only allow internal (same-site) redirect targets. */
function safeNext(next: string | undefined): string | undefined {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  // Already signed in and arriving via a handoff → go straight through.
  if (user && next) redirect(next);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md px-7 py-8">
        {user ? (
          <div className="text-center">
            <p className="text-sm text-muted">Signed in as</p>
            <p className="mt-1 font-semibold text-ink">{user.email}</p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Link
                href="/"
                className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#2a3756]"
              >
                Go to dashboard
              </Link>
              <SignOutButton />
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <LoginForm
              next={next}
              initialError={error ? ERROR_MESSAGES[error] ?? "Something went wrong." : undefined}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
