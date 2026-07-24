"use client";

import { useState } from "react";
import type { AccountFactor, DealerAccount } from "@/lib/window/types";
import { Badge, Button, Card, Input, Select } from "./ui";

// Admin: dealer companies, their pricing factors, user↔account assignment, and the org-level
// rollout switch that opens the Window Catalog to dealer users. Everything defaults OFF so
// live retailers notice nothing until the factory flips it.

type AccountWithFactors = DealerAccount & { factors: AccountFactor[] };
type DealerUser = { id: string; email: string; company: string | null; dealerAccountId: number | null };

type Props = {
  initialAccounts: AccountWithFactors[];
  initialUsers: DealerUser[];
  initialAccess: boolean;
  lineKeys: string[];
  products: { id: number; name: string }[];
};

export default function WindowDealersAdmin({ initialAccounts, initialUsers, initialAccess, lineKeys, products }: Props) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [users, setUsers] = useState(initialUsers);
  const [access, setAccess] = useState(initialAccess);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    setError(null);
    const res = await fetch("/api/window/dealer-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    if (!res.ok) {
      setError(out.error ?? "Action failed");
      throw new Error(out.error);
    }
    return out;
  }

  async function refresh() {
    const res = await fetch("/api/window/dealer-accounts");
    if (res.ok) {
      const out = await res.json();
      setAccounts(out.accounts);
      setUsers(out.users);
      setAccess(out.dealerWindowAccess);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {/* rollout switch */}
      <Card className="flex items-center justify-between p-5">
        <div>
          <div className="text-sm font-semibold text-ink">Dealer access to the Window Catalog</div>
          <p className="mt-1 max-w-xl text-xs text-muted">
            When on, retailer logins linked to a dealer account below see a “Window Products” catalog and can
            quote/order at their account factor. Off = the entire window surface stays admin-only.
          </p>
        </div>
        <Button
          variant={access ? "secondary" : "primary"}
          onClick={async () => {
            const out = await post({ setDealerWindowAccess: !access });
            setAccess(Boolean(out.dealerWindowAccess));
          }}
        >
          {access ? "Turn off" : "Turn on"}
        </Button>
      </Card>

      {/* accounts + factors */}
      <Card className="p-5">
        <div className="text-sm font-semibold text-ink">Dealer accounts</div>
        <div className="mt-3 space-y-3">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} lineKeys={lineKeys} products={products} onPost={post} onDone={refresh} />
          ))}
          {accounts.length === 0 && <div className="text-xs text-muted">None yet.</div>}
        </div>
        <NewAccount onPost={post} onDone={refresh} />
      </Card>

      {/* user assignment */}
      <Card className="p-5">
        <div className="text-sm font-semibold text-ink">Retailer users → dealer accounts</div>
        <p className="mt-1 text-xs text-muted">A linked user prices and orders at that account&apos;s factor.</p>
        <div className="mt-3 space-y-1.5">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-line/60 px-3 py-1.5">
              <span className="min-w-0 truncate text-xs">
                <span className="font-medium text-ink">{u.email}</span>
                {u.company && <span className="text-muted"> · {u.company}</span>}
              </span>
              <Select
                value={u.dealerAccountId ?? 0}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  await post({ assignUserId: u.id, dealerAccountId: v === 0 ? null : v });
                  setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, dealerAccountId: v === 0 ? null : v } : x)));
                }}
                className="w-56 text-xs"
              >
                <option value={0}>— not linked —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {users.length === 0 && <div className="text-xs text-muted">No retailer users yet.</div>}
        </div>
      </Card>
    </div>
  );
}

function AccountRow({
  account,
  lineKeys,
  products,
  onPost,
  onDone,
}: {
  account: AccountWithFactors;
  lineKeys: string[];
  products: { id: number; name: string }[];
  onPost: (b: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onDone: () => Promise<void>;
}) {
  const [scope, setScope] = useState("blanket"); // 'blanket' | line key | `p:${productId}`
  const [factor, setFactor] = useState("");

  return (
    <div className="rounded-lg border border-line/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">{account.name}</div>
        <div className="flex flex-wrap gap-1.5">
          {account.factors.map((f) => (
            <Badge key={f.id} className="border-line bg-black/[.03] text-ink-soft">
              {f.productId != null
                ? products.find((p) => p.id === f.productId)?.name ?? `product ${f.productId}`
                : f.lineKey ?? "all"}{" "}
              × {f.factor}
            </Badge>
          ))}
          {account.factors.length === 0 && (
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">no factor — cannot order</Badge>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Select value={scope} onChange={(e) => setScope(e.target.value)} className="w-52 text-xs">
          <option value="blanket">All products (blanket)</option>
          {lineKeys.map((k) => (
            <option key={k} value={k}>
              line: {k}
            </option>
          ))}
          {products.map((p) => (
            <option key={p.id} value={`p:${p.id}`}>
              product: {p.name}
            </option>
          ))}
        </Select>
        <Input value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="factor e.g. 0.35" className="w-32" />
        <Button
          variant="secondary"
          disabled={!factor.trim()}
          onClick={async () => {
            const body: Record<string, unknown> = { dealerAccountId: account.id, factor: Number(factor) };
            if (scope.startsWith("p:")) body.productId = Number(scope.slice(2));
            else if (scope !== "blanket") body.lineKey = scope;
            await onPost(body);
            setFactor("");
            await onDone();
          }}
        >
          Set factor
        </Button>
      </div>
    </div>
  );
}

function NewAccount({
  onPost,
  onDone,
}: {
  onPost: (b: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <div className="mt-4 flex items-end gap-2 border-t border-line/50 pt-4">
      <label className="block flex-1">
        <span className="mb-1 block text-xs font-medium text-muted">New dealer company</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
      </label>
      <Button
        variant="secondary"
        disabled={!name.trim()}
        onClick={async () => {
          await onPost({ name: name.trim() });
          setName("");
          await onDone();
        }}
      >
        Add
      </Button>
    </div>
  );
}
