import Link from "next/link";
import { DraperyScene, RollerShadeScene } from "@/components/renders";
import { Badge, Card, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireUserId } from "@/lib/auth/user";
import { getOrders, getProduct, getQuotes, getRecentEvents } from "@/lib/db";
import { fmtDateTime, ORDER_STATUS_META, usd } from "@/lib/format";
import { ORDER_STATUSES } from "@/lib/types";

const ACTOR_LABEL: Record<string, string> = {
  retailer: "You",
  supplier: "Supplier",
  logistics: "Logistics",
  system: "System",
};

export default async function Dashboard() {
  const ownerId = await requireUserId("/");
  const quotes = await getQuotes(ownerId);
  const orders = await getOrders(ownerId);
  const events = await getRecentEvents(7, ownerId);

  const draftQuotes = quotes.filter((q) => q.status === "draft");
  const draftValue = draftQuotes.reduce((s, q) => s + q.total, 0);
  const active = orders.filter((o) => o.status !== "delivered");
  const activeValue = active.reduce((s, o) => s + o.total, 0);
  const delivered = orders.filter((o) => o.status === "delivered");

  const rollerHero = getProduct("rs-linum")!;
  const draperyHero = getProduct("dp-velluto")!;

  return (
    <div>
      <PageHeader
        eyebrow="Harbor & Lane Interiors"
        title="Trade Dashboard"
        description="Quote factory-direct roller shades and drapery, place pre-orders straight into the supply chain, and track every order to the door."
        actions={<LinkButton href="/catalog">Browse catalog →</LinkButton>}
      />

      <div className="rise grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open quotes" value={usd(draftValue)} sub={`${draftQuotes.length} draft${draftQuotes.length === 1 ? "" : "s"} in progress`} />
        <Stat label="Active pre-orders" value={active.length} sub={`${usd(activeValue)} committed`} />
        <Stat
          label="In production"
          value={orders.filter((o) => o.status === "in_production").length}
          sub="At Shenzhen facility"
        />
        <Stat label="Delivered" value={delivered.length} sub="All-time, this account" />
      </div>

      {/* product line heroes */}
      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Link href="/catalog?line=roller-shade" className="group">
          <Card className="overflow-hidden transition-shadow hover:shadow-md">
            <div className="h-52 overflow-hidden">
              <RollerShadeScene
                color={rollerHero.colors[2]}
                patternStyle={rollerHero.patternStyle}
                opacityId="light-filtering"
                widthCm={170}
                heightCm={150}
                mount="outside"
                headrail="cassette"
                control="motorized"
                drop={0.62}
              />
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-4">
              <div>
                <div className="text-[15px] font-semibold text-ink">Roller Shade</div>
                <div className="text-xs text-muted">6 patterns · grid-priced · 18-day lead time</div>
              </div>
              <span className="text-sm font-medium text-brass transition-transform group-hover:translate-x-0.5">
                Configure →
              </span>
            </div>
          </Card>
        </Link>
        <Link href="/catalog?line=drapery" className="group">
          <Card className="overflow-hidden transition-shadow hover:shadow-md">
            <div className="h-52 overflow-hidden">
              <DraperyScene
                color={draperyHero.colors[0]}
                patternStyle={draperyHero.patternStyle}
                opacityId="room-darkening"
                rodWidthCm={300}
                heightCm={250}
                panels="pair"
                fullness="2.5"
                header="pinch-pleat"
                openAmount={0.5}
              />
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-4">
              <div>
                <div className="text-[15px] font-semibold text-ink">Drapery</div>
                <div className="text-xs text-muted">6 fabrics · cut &amp; make formula · 22-day lead time</div>
              </div>
              <span className="text-sm font-medium text-brass transition-transform group-hover:translate-x-0.5">
                Configure →
              </span>
            </div>
          </Card>
        </Link>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-5">
        {/* pipeline */}
        <Card className="lg:col-span-2 px-5 py-5">
          <h2 className="text-sm font-semibold text-ink">Fulfillment pipeline</h2>
          <p className="mt-0.5 text-xs text-muted">Live order count per stage</p>
          <div className="mt-4 space-y-2.5">
            {ORDER_STATUSES.map((s) => {
              const n = orders.filter((o) => o.status === s).length;
              const meta = ORDER_STATUS_META[s];
              return (
                <div key={s} className="flex items-center gap-3">
                  <StatusBadge status={s} className="w-36 justify-center" />
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#efede6]">
                    <div
                      className="h-full rounded-full bg-ink/70"
                      style={{ width: orders.length ? `${(n / orders.length) * 100}%` : 0 }}
                    />
                  </div>
                  <span className="w-5 text-right text-sm font-semibold text-ink">{n}</span>
                  <span className="sr-only">{meta.description}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* activity */}
        <Card className="lg:col-span-3 px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Latest updates</h2>
              <p className="mt-0.5 text-xs text-muted">Status pushed from the supplier &amp; logistics layer</p>
            </div>
            <LinkButton href="/orders" variant="secondary" className="px-3 py-1.5 text-xs">
              All pre-orders
            </LinkButton>
          </div>
          <ul className="mt-4 divide-y divide-line/70">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <Badge tone="brass" className="mt-0.5 shrink-0">
                  {ACTOR_LABEL[e.actor]}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-ink-soft">{e.note}</p>
                  <div className="mt-0.5 text-[11px] text-muted">
                    <Link href="/orders" className="font-medium text-ink/70 hover:text-brass">
                      {e.orderRef}
                    </Link>{" "}
                    · {fmtDateTime(e.createdAt)}
                  </div>
                </div>
              </li>
            ))}
            {events.length === 0 && <li className="py-6 text-sm text-muted">No activity yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
