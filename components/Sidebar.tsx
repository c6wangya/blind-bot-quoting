"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronUp,
  Cpu,
  Factory,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  MessageSquare,
  Package,
  Settings,
  Tag,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/brand";
import { ActingAsSwitcher, type RetailerOption } from "./ActingAsSwitcher";
import { cx } from "./ui";

type NavItem = {
  href?: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  retailerOnly?: boolean;
  children?: { href: string; label: string; adminOnly?: boolean }[];
};

const NAV: { section: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    section: "Retailer Portal",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      {
        label: "Catalog",
        icon: BookOpen,
        children: [
          { href: "/catalog", label: "Products" },
          { href: "/catalog/accessories", label: "Accessory" },
        ],
      },
      { href: "/quotes", label: "Quotes", icon: FileText },
      { href: "/orders", label: "Orders", icon: Package },
      // Retailer's own support chat. Admins reach the inbox from Admin Console instead.
      { href: "/messages", label: "Messages", icon: MessageSquare, retailerOnly: true },
    ],
  },
  {
    // Entire section is admin-only — everything back-office lives here.
    section: "Admin Console",
    adminOnly: true,
    items: [
      { href: "/messages", label: "Messages", icon: MessageSquare },
      { href: "/motors", label: "Motors", icon: Cpu },
      { href: "/supplier", label: "Supplier Console", icon: Factory },
      { href: "/pricing", label: "Pricing Versions", icon: Tag },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export default function Sidebar({
  draftCount,
  unread,
  supplierPending,
  accountName,
  accountSub,
  signedIn,
  isAdmin,
  retailers,
  actingAsId,
  open,
  onClose,
}: {
  draftCount: number;
  unread: number;
  supplierPending: number;
  accountName: string;
  accountSub: string;
  signedIn: boolean;
  isAdmin: boolean;
  retailers: RetailerOption[];
  actingAsId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the account popover on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : href === "/catalog"
        ? pathname === "/catalog" || pathname.startsWith("/configure")
        : pathname.startsWith(href);
  const initials =
    accountName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  // Item-level visibility (Messages differs by role); groups are filtered separately.
  const visible = (item: NavItem) => (!item.adminOnly || isAdmin) && (!item.retailerOnly || !isAdmin);

  const handleSignOut = async () => {
    const supabase = createClient();
    if (supabase) await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <aside
      className={cx(
        "fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-[#1a2336] text-white transition-transform duration-200 md:z-30 md:translate-x-0",
        open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      )}
    >
      <Link href="/" onClick={onClose} className="flex items-center gap-3 px-5 pb-5 pt-6">
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
              {group.items.filter(visible).map((item) => {
                // Parent with nested children (Catalog → Products / Accessory)
                if (item.children) {
                  const children = item.children.filter((c) => !c.adminOnly || isAdmin);
                  const groupActive = children.some((c) => isActive(c.href));
                  return (
                    <div key={item.label}>
                      <div className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium text-white/60">
                        <span className={cx("flex w-5 justify-center", groupActive ? "text-brass" : "text-white/40")}>
                          <item.icon className="size-[17px]" strokeWidth={1.75} />
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
                              onClick={onClose}
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
                    onClick={onClose}
                    className={cx(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors",
                      active
                        ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                        : "text-white/60 hover:bg-white/5 hover:text-white/90"
                    )}
                  >
                    <span
                      className={cx(
                        "flex w-5 justify-center",
                        active ? "text-brass" : "text-white/40 group-hover:text-white/70"
                      )}
                    >
                      <item.icon className="size-[17px]" strokeWidth={1.75} />
                    </span>
                    {item.label}
                    {href === "/quotes" && draftCount > 0 && (
                      <span className="ml-auto rounded-full bg-brass px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#1a2336]">
                        {draftCount}
                      </span>
                    )}
                    {href === "/messages" && unread > 0 && (
                      <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                    {href === "/supplier" && supplierPending > 0 && (
                      <span className="ml-auto rounded-full bg-brass px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#1a2336]">
                        {supplierPending > 99 ? "99+" : supplierPending}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {isAdmin && (
        <div className="border-t border-white/10">
          <ActingAsSwitcher retailers={retailers} actingAsId={actingAsId} />
        </div>
      )}

      <div ref={menuRef} className="relative border-t border-white/10 px-3 py-3">
        {/* Account popover — opens upward, anchored to the user row below. */}
        {signedIn && menuOpen && (
          <div className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-xl bg-white text-ink shadow-2xl ring-1 ring-black/10">
            <Link
              href="/account#password"
              onClick={() => {
                setMenuOpen(false);
                onClose();
              }}
              className="flex items-center gap-3 px-4 py-3 text-[13.5px] font-medium text-ink transition-colors hover:bg-black/[0.04]"
            >
              <KeyRound className="size-[18px] text-muted" strokeWidth={1.75} />
              Change password
            </Link>
            {isAdmin && (
              <>
                <div className="h-px bg-black/[0.06]" />
                <Link
                  href="/settings"
                  onClick={() => {
                    setMenuOpen(false);
                    onClose();
                  }}
                  className="flex items-center gap-3 px-4 py-3 text-[13.5px] font-medium text-ink transition-colors hover:bg-black/[0.04]"
                >
                  <Settings className="size-[18px] text-muted" strokeWidth={1.75} />
                  Company info
                </Link>
              </>
            )}
            <div className="h-px bg-black/[0.06]" />
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                handleSignOut();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-[13.5px] font-medium text-ink transition-colors hover:bg-black/[0.04]"
            >
              <LogOut className="size-[18px] text-muted" strokeWidth={1.75} />
              Sign out
            </button>
          </div>
        )}

        {signedIn ? (
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5b6b8f] to-[#3a4763] text-xs font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-[12.5px] font-medium">{accountName}</div>
              <div className="truncate text-[10.5px] text-white/40">{accountSub}</div>
            </div>
            <ChevronUp
              className={cx("size-4 shrink-0 text-white/40 transition-transform", menuOpen ? "rotate-180" : "")}
              strokeWidth={2}
            />
          </button>
        ) : (
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5b6b8f] to-[#3a4763] text-xs font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium">{accountName}</div>
              <div className="truncate text-[10.5px] text-white/40">{accountSub}</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
