"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/brand";
import { cx } from "./ui";

type NavItem = {
  href?: string;
  label: string;
  icon: string;
  children?: { href: string; label: string; adminOnly?: boolean }[];
};

const NAV: { section: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    section: "Retailer Portal",
    items: [
      { href: "/", label: "Dashboard", icon: "▦" },
      {
        label: "Catalog",
        icon: "❖",
        children: [
          { href: "/catalog", label: "Products" },
          { href: "/catalog/accessories", label: "Accessory" },
        ],
      },
      { href: "/quotes", label: "Quotes", icon: "≣" },
      { href: "/orders", label: "Pre-Orders", icon: "⬡" },
    ],
  },
  {
    // Entire section is admin-only — everything back-office lives here.
    section: "Admin Console",
    adminOnly: true,
    items: [
      { href: "/motors", label: "Motors", icon: "◉" },
      { href: "/supplier", label: "Supplier Console", icon: "⚙" },
      { href: "/pricing", label: "Pricing Versions", icon: "$" },
    ],
  },
];

export default function Sidebar({
  draftCount,
  accountName,
  accountSub,
  signedIn,
  isAdmin,
}: {
  draftCount: number;
  accountName: string;
  accountSub: string;
  signedIn: boolean;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : href === "/catalog"
        ? pathname === "/catalog" || pathname.startsWith("/configure")
        : pathname.startsWith(href);
  const initials =
    accountName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

  const handleSignOut = async () => {
    const supabase = createClient();
    if (supabase) await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-[#1a2336] text-white">
      <Link href="/" className="flex items-center gap-3 px-5 pb-5 pt-6">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brass to-[#8a6a39] text-base font-bold shadow-md">
          {BRAND.monogram}
        </div>
        <div>
          <div className="text-[15px] font-semibold leading-tight tracking-tight">{BRAND.name}</div>
          <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">{BRAND.tagline}</div>
        </div>
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {NAV.filter((group) => !group.adminOnly || isAdmin).map((group) => (
          <div key={group.section}>
            <div className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
              {group.section}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                // Parent with nested children (Catalog → Products / Accessory)
                if (item.children) {
                  const children = item.children.filter((c) => !c.adminOnly || isAdmin);
                  const groupActive = children.some((c) => isActive(c.href));
                  return (
                    <div key={item.label}>
                      <div className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium text-white/60">
                        <span
                          className={cx(
                            "flex w-5 justify-center text-[15px]",
                            groupActive ? "text-brass" : "text-white/40"
                          )}
                        >
                          {item.icon}
                        </span>
                        {item.label}
                      </div>
                      <div className="mb-0.5 ml-[26px] space-y-0.5 border-l border-white/10 pl-3">
                        {children.map((c) => {
                          const active = isActive(c.href);
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              className={cx(
                                "block rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                                active
                                  ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                                  : "text-white/55 hover:bg-white/5 hover:text-white/90"
                              )}
                            >
                              {c.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                const href = item.href!;
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cx(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors",
                      active
                        ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                        : "text-white/60 hover:bg-white/5 hover:text-white/90"
                    )}
                  >
                    <span
                      className={cx(
                        "flex w-5 justify-center text-[15px]",
                        active ? "text-brass" : "text-white/40 group-hover:text-white/70"
                      )}
                    >
                      {item.icon}
                    </span>
                    {item.label}
                    {href === "/quotes" && draftCount > 0 && (
                      <span className="ml-auto rounded-full bg-brass px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#1a2336]">
                        {draftCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5b6b8f] to-[#3a4763] text-xs font-semibold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium">{accountName}</div>
            <div className="truncate text-[10.5px] text-white/40">{accountSub}</div>
          </div>
          {signedIn && (
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="shrink-0 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
