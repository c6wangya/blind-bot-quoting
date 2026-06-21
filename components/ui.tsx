import Link from "next/link";
import { ORDER_STATUS_META } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(31,42,68,0.05)]", className)}>
      {children}
    </div>
  );
}

const TONES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  brass: "bg-brass-soft text-[#8a6a39] ring-[#e5d3b3]",
};

export function Badge({
  tone = "slate",
  children,
  className,
}: {
  tone?: keyof typeof TONES | string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone] ?? TONES.slate,
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <Badge tone={meta.tone} className={className}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {meta.label}
    </Badge>
  );
}

/** A subtle "‹ Back" link for detail/sub-pages. Place above the PageHeader. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rise mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-ink"
    >
      <span className="text-base leading-none">‹</span> {children}
    </Link>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rise mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brass">{eyebrow}</div>
        )}
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  children,
  className,
}: {
  href: string;
  variant?: "primary" | "secondary";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
        variant === "primary"
          ? "bg-ink text-white shadow-sm hover:bg-[#2a3756] hover:shadow"
          : "border border-line bg-surface text-ink hover:border-[#d5d0c4] hover:bg-[#faf9f5]",
        className
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Button primitive — owns the shared color/hover/shadow/disabled treatment so action
 * components don't re-hand-roll the same class blob. Size/width stay caller-controlled via
 * `className` (paddings vary across the app). For links, use `LinkButton` instead.
 */
export function Button({
  variant = "primary",
  busy = false,
  className,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-all disabled:opacity-50",
        variant === "primary" && "bg-ink text-white hover:bg-[#2a3756] hover:shadow",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "secondary" && "border border-line bg-surface font-medium text-ink-soft shadow-none hover:bg-[#faf9f5]",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-brass-soft text-xl">🪟</div>
      <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}
