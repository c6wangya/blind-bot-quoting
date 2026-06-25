"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "./Toast";
import { Button, Card, cx, Input } from "./ui";

// Password policy: at least 8 characters, made up only of English letters, numbers and the
// common symbols below. Keep ALLOWED_SYMBOLS and ALLOWED_RE in sync with the helper text.
const ALLOWED_SYMBOLS = "_ . * ! @ # $ % & - +";
const ALLOWED_RE = /^[A-Za-z0-9_.*!@#$%&+-]+$/;

const RULES: { label: string; test: (s: string) => boolean }[] = [
  { label: "At least 8 characters", test: (s) => s.length >= 8 },
  { label: "Only letters, numbers and allowed symbols", test: (s) => ALLOWED_RE.test(s) },
];

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted transition-colors hover:text-ink"
        >
          {show ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.22A10.5 10.5 0 0 0 1.93 12C3.23 16.34 7.24 19.5 12 19.5c.99 0 1.95-.14 2.86-.39M6.23 6.23A10.45 10.45 0 0 1 12 4.5c4.76 0 8.77 3.16 10.07 7.5a10.52 10.52 0 0 1-4.3 5.27M6.23 6.23 3 3m3.23 3.23 11.54 11.54M17.77 17.77 21 21m-9-5a3 3 0 0 1-2.12-5.12" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.04 12.32a1 1 0 0 1 0-.64C3.42 7.51 7.36 4.5 12 4.5s8.58 3.01 9.96 7.18a1 1 0 0 1 0 .64C20.58 16.49 16.64 19.5 12 19.5s-8.58-3.01-9.96-7.18Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}

export function ChangePasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supabase) {
    return <Card className="max-w-md p-5 text-sm text-muted">Sign-in isn&apos;t configured.</Card>;
  }

  const checks = RULES.map((r) => r.test(next));
  const allPass = checks.every(Boolean);
  const match = next.length > 0 && next === confirm;
  const canSubmit = current.length > 0 && allPass && match && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!allPass) return setError("New password doesn't meet the requirements.");
    if (!match) return setError("The two new passwords don't match.");
    setBusy(true);
    try {
      // 1) Verify the current password by re-authenticating (keeps the session on success;
      //    a wrong password just returns an error and leaves the session untouched).
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: current });
      if (signErr) {
        setError("Current password is incorrect.");
        return;
      }
      // 2) Set the new password and clear the "still on initial password" nudge flag.
      const { error: updErr } = await supabase.auth.updateUser({
        password: next,
        data: { must_change_password: false },
      });
      if (updErr) throw updErr;
      toast("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
      router.refresh(); // re-render the layout so the nudge banner goes away
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-md space-y-4 p-5">
      <form onSubmit={submit} className="space-y-4">
        <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />

        <div>
          <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" />
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Only English letters, numbers and these symbols are allowed: {ALLOWED_SYMBOLS}
          </p>
        </div>

        <ul className="space-y-1">
          {RULES.map((r, i) => (
            <li key={r.label} className="flex items-center gap-2 text-[12px]">
              <span
                className={cx(
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                  next.length > 0 && checks[i] ? "bg-emerald-500 text-white" : "bg-[#eceae3] text-muted"
                )}
              >
                {next.length > 0 && checks[i] ? "✓" : ""}
              </span>
              <span className={cx(next.length > 0 && checks[i] ? "text-ink-soft" : "text-muted")}>{r.label}</span>
            </li>
          ))}
        </ul>

        <div>
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {confirm.length > 0 && !match && (
            <span className="mt-1 block text-[11px] text-red-500">Passwords don&apos;t match.</span>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <Button type="submit" variant="primary" busy={busy} disabled={!canSubmit} className="py-2">
          Update password
        </Button>
      </form>
    </Card>
  );
}
