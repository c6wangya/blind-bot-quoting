import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/ui";
import Configurator from "@/components/Configurator";
import { userClient } from "@/lib/auth/user";
import { getActivePricing, getLine, getProduct, getQuote } from "@/lib/db";
import { parseImportPayload } from "@/lib/import";
import { createClient } from "@/lib/supabase/server";
import { isAccessoryConfig, type ItemConfig } from "@/lib/types";

export default async function ConfigurePage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ img?: string; cfg?: string; line?: string; quote?: string; item?: string }>;
}) {
  const { productId } = await params;
  const { img, cfg, line: lineParam, quote, item } = await searchParams;
  const quoteId = quote && Number.isInteger(Number(quote)) ? Number(quote) : undefined;
  const itemId = item && Number.isInteger(Number(item)) ? Number(item) : undefined;
  const product = getProduct(productId);
  if (!product) notFound();
  const line = getLine(product.lineId)!;
  const pricing = await getActivePricing(product.lineId);
  const imported = parseImportPayload(img, cfg);

  // Editing an existing line: load its config (RLS-scoped — only the user's own quote).
  let editItem: { id: number; config: ItemConfig; qty: number } | undefined;
  if (quoteId && itemId) {
    const quote = await getQuote(quoteId, await userClient());
    const found = quote?.items.find((i) => i.id === itemId);
    if (found && found.productId === productId && !isAccessoryConfig(found.config)) {
      editItem = { id: found.id, config: found.config, qty: found.qty };
    }
  }

  // Cross-system handoff requires a signed-in retailer: if a design is being
  // imported and there's no session, send them to login first and come back
  // here (preserving the import data). Normal catalog→configure browsing has no
  // import params, so it is NOT gated.
  if (imported) {
    const supabase = await createClient();
    // When auth isn't configured (no Supabase env), skip the gate so the import
    // still works — the handoff just isn't login-protected in that case.
    if (supabase) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        const qs = new URLSearchParams();
        if (lineParam) qs.set("line", lineParam);
        if (img) qs.set("img", img);
        if (cfg) qs.set("cfg", cfg);
        redirect(`/login?next=${encodeURIComponent(`/configure/${productId}?${qs.toString()}`)}`);
      }
    }
  }

  return (
    <div>
      {quoteId && <BackLink href={`/quotes/${quoteId}`}>Back to quote</BackLink>}
      <nav className="rise mb-5 text-[13px] text-muted">
        <Link href="/catalog" className="hover:text-brass">
          Catalog
        </Link>
        <span className="mx-2 text-line">/</span>
        <Link href={`/catalog?line=${line.id}`} className="hover:text-brass">
          {line.name}
        </Link>
        <span className="mx-2 text-line">/</span>
        <span className="font-medium text-ink">{product.name}</span>
      </nav>
      <Configurator
        product={product}
        line={line}
        pricingVersion={pricing.version}
        leadTimeDays={line.leadTimeDays}
        imported={imported}
        quoteId={quoteId}
        editItem={editItem}
      />
    </div>
  );
}
