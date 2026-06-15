import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireUserId } from "@/lib/auth/user";
import { getQuotes } from "@/lib/db";
import { fmtDate, usd } from "@/lib/format";

export default async function QuotesPage() {
  const ownerId = await requireUserId("/quotes");
  const quotes = await getQuotes(ownerId);

  return (
    <div>
      <PageHeader
        eyebrow="Quoting"
        title="Quotes"
        description="Auto-priced by the backend formula engine from catalog, variations and dimensions. Submit a draft to convert it into a supply-chain pre-order."
        actions={<LinkButton href="/catalog">New quote item →</LinkButton>}
      />

      {quotes.length === 0 ? (
        <EmptyState
          title="No quotes yet"
          description="Configure a product from the catalog and it will land in a draft quote here."
          action={<LinkButton href="/catalog">Browse catalog</LinkButton>}
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#fafaf7] text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Quote</th>
                <th className="px-5 py-3">Project</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Items</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">Updated</th>
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
                  <td className="px-5 py-3.5">
                    {q.status === "draft" ? (
                      <Badge tone="amber">Draft</Badge>
                    ) : (
                      <Badge tone="green">Converted to pre-order</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-ink-soft">{q.itemCount}</td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-ink">{usd(q.total)}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-muted">{fmtDate(q.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
