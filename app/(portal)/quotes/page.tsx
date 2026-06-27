import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ListToolbar } from "@/components/ListToolbar";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import { getQuotes } from "@/lib/db";
import { canInvoiceQuote } from "@/lib/invoice";
import { fmtDate, usd } from "@/lib/format";
import { pageSlice, parseListParams, PAGE_SIZE } from "@/lib/list";

const QUOTE_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "converted", label: "Converted" },
];

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // While acting on behalf of a retailer, list THAT retailer's quotes (service_role bypasses RLS
  // for the cross-owner read); otherwise the signed-in user's own RLS-scoped quotes.
  const ctx = await getActingContext();
  if (!ctx.realUid) redirect(`/login?next=${encodeURIComponent("/quotes")}`);
  const ownerId = ctx.actingAsId ?? ctx.realUid;
  const sb = ctx.actingAsId ? admin() : await userClient();
  const all = await getQuotes(ownerId, sb);
  const { q, status, page } = parseListParams(await searchParams);
  const ql = q.toLowerCase();
  const filtered = all.filter(
    (x) =>
      (!status || x.status === status) &&
      (!q || `${x.ref} ${x.projectName ?? ""} ${x.customerName ?? ""} ${x.sidemark ?? ""} ${x.po ?? ""}`.toLowerCase().includes(ql))
  );
  const quotes = pageSlice(filtered, page);

  return (
    <div>
      <PageHeader
        eyebrow="Quoting"
        title="Quotes"
        description="Auto-priced by the backend formula engine from catalog, variations and dimensions. Submit a draft to convert it into a supply-chain order."
        actions={<LinkButton href="/quotes/new">Create New Quote</LinkButton>}
      />

      {all.length === 0 ? (
        <EmptyState
          title="No quotes yet"
          description="Start a quote with the customer and ship-to details, then add products — or configure a product from the catalog and we'll help you create one."
          action={<LinkButton href="/quotes/new">Create New Quote</LinkButton>}
        />
      ) : (
        <>
        <ListToolbar basePath="/quotes" q={q} status={status} statuses={QUOTE_STATUS_OPTIONS} total={filtered.length} page={page} pageSize={PAGE_SIZE} />

        {/* Mobile: cards */}
        <div className="space-y-3 md:hidden">
          {quotes.map((qt) => (
            <Link key={qt.id} href={`/quotes/${qt.id}`} className="block rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-ink">{qt.ref}</span>
                {qt.status === "draft" ? <Badge tone="amber">Draft</Badge> : <Badge tone="green">Converted</Badge>}
              </div>
              {(qt.projectName || qt.customerName) && (
                <div className="mt-1 truncate text-[13px] text-muted">{qt.projectName ?? qt.customerName}</div>
              )}
              <div className="mt-2 flex items-center justify-between text-[13px]">
                <span className="text-muted">{qt.itemCount} item{qt.itemCount === 1 ? "" : "s"} · {fmtDate(qt.updatedAt)}</span>
                <span className="font-semibold tabular-nums text-ink">{usd(qt.total)}</span>
              </div>
            </Link>
          ))}
          {quotes.length === 0 && <p className="py-8 text-center text-sm text-muted">No quotes match your search.</p>}
        </div>

        {/* Desktop: table */}
        <Card className="hidden overflow-hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#fafaf7] text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Quote</th>
                <th className="px-5 py-3">Project</th>
                <th className="px-5 py-3">Contact</th>
                <th className="px-5 py-3">Sidemark</th>
                <th className="px-5 py-3">PO</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Items</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">Updated</th>
                <th className="px-5 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="group border-b border-line/60 transition-colors last:border-0 hover:bg-[#fbfaf6]">
                  <td className="px-5 py-3.5">
                    <Link href={`/quotes/${q.id}`} className="font-semibold text-ink group-hover:text-brass">
                      {q.ref}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-ink-soft">{q.projectName ?? "—"}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{q.customerName ?? "—"}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{q.sidemark ?? "—"}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{q.po ?? "—"}</td>
                  <td className="px-5 py-3.5">
                    {q.status === "draft" ? (
                      <Badge tone="amber">Draft</Badge>
                    ) : (
                      <Badge tone="green">Converted to order</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-ink-soft">{q.itemCount}</td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-ink">{usd(q.total)}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-muted">{fmtDate(q.updatedAt)}</td>
                  <td className="px-5 py-3.5 text-right">
                    {canInvoiceQuote(q, ownerId) ? (
                      <Link
                        href={`/invoices/${q.id}`}
                        prefetch={false}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-brass hover:underline"
                      >
                        Invoice
                      </Link>
                    ) : (
                      <span
                        className="cursor-not-allowed text-xs font-semibold text-muted/40"
                        title="Only your own quotes with complete customer & ship-to details can be invoiced"
                      >
                        Invoice
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {quotes.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No quotes match your search.</p>}
        </Card>
        </>
      )}
    </div>
  );
}
