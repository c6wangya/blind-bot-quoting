"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/brand";
import { cx } from "./ui";

export default function LoginForm({ initialError, next }: { initialError?: string; next?: string }) {
  const router = useRouter();
  const supabase = createClient();
  // Internal paths only — reject protocol-relative "//evil.com" (matches the server safeNext guards).
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [info, setInfo] = useState<string | null>(null);

  if (!supabase) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{BRAND.name}</h1>
        <p className="mt-3 text-sm text-muted">
          Sign-in isn&apos;t configured yet — add the Supabase environment variables to enable login.
        </p>
      </div>
    );
  }

  const google = async () => {
    setError(null);
    const redirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(dest)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setError(error.message);
  };

  // Reverse "Continue with BlindBot": bounce to blind-bot's authorize page, which (after
  // consent) mints a signed handoff token and redirects back to our callback. Shown only
  // when the blind-bot frontend URL is configured.
  const blindbotFrontend = process.env.NEXT_PUBLIC_BLINDBOT_FRONTEND_URL?.replace(/\/$/, "");
  const continueWithBlindbot = () => {
    if (!blindbotFrontend) return;
    const redirectUri = `${location.origin}/api/handoff/callback`;
    const url =
      `${blindbotFrontend}/authorize-quote` +
      `?redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&next=${encodeURIComponent(dest)}` +
      `&brand=${encodeURIComponent(BRAND.name)}`;
    window.location.assign(url);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setInfo("Check your email to confirm your account, then sign in.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await fetch("/api/auth/sync", { method: "POST" });
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{BRAND.name}</h1>
        <p className="mt-1 text-sm text-muted">Sign in to quote and pre-order.</p>
      </div>

      <button
        onClick={google}
        className="relative mt-6 flex w-full items-center justify-center rounded-xl border border-line bg-surface py-2.5 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-[#faf9f5]"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden className="absolute left-4">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.4 5.4 2.4 13.2l7.9 6.1C12.2 13.3 17.6 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v7.4h12.7c-.3 2.1-1.6 5.2-4.7 7.3l7.3 5.6c4.4-4 6.8-10 6.8-16.2z" />
          <path fill="#FBBC05" d="M10.3 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.4 10.8l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.3-5.6c-2 1.4-4.7 2.3-8.2 2.3-6.4 0-11.8-3.8-13.7-9.3l-7.9 6.1C6.4 42.6 14.6 48 24 48z" />
        </svg>
        Continue with Google
      </button>

      {blindbotFrontend && (
        <button
          onClick={continueWithBlindbot}
          className="relative mt-4 flex w-full items-center justify-center rounded-xl bg-ink py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2a3756]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/blindbot-icon.png" alt="" width={20} height={20} className="absolute left-4 rounded-[5px]" />
          Continue with BlindBot
        </button>
      )}

      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={busy}
          className={cx(
            "w-full rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition-colors",
            busy ? "cursor-not-allowed bg-[#e9e6dd] text-muted" : "bg-ink hover:bg-[#2a3756]"
          )}
        >
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      {error && <p className="mt-3 text-center text-xs text-red-500">{error}</p>}
      {info && <p className="mt-3 text-center text-xs text-emerald-600">{info}</p>}

      <p className="mt-5 text-center text-xs text-muted">
        {mode === "signup" ? "Already have an account?" : "Need an account?"}{" "}
        <button
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
            setInfo(null);
          }}
          className="font-medium text-brass hover:underline"
        >
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>
    </div>
  );
}
