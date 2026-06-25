import { admin } from "@/lib/supabase/admin";

// THE-772 — invoice numbering. An invoice number must be unique, sequential and immutable once
// issued, so we lazily assign one onto quotes.invoice_ref the first time an invoice is generated
// and never recompute it. Format INV{YYYYMMDD}{NN} (e.g. INV2026061902 = the 2nd invoice issued on
// 2026-06-19) — date stamp + per-day sequence, padded to 2 digits. The issue date lives in the
// number itself (the invoice page parses it back for "Invoice Date"). The scan + write use admin()
// so the sequence is correct across all retailers (RLS would hide other retailers' refs).

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Today as YYYYMMDD (server local), the date the invoice is issued. */
function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

async function nextInvoiceRef(): Promise<string> {
  const stamp = todayStamp();
  const { data } = await admin()
    .from("quotes")
    .select("invoice_ref")
    .like("invoice_ref", `INV${stamp}%`)
    .order("invoice_ref", { ascending: false })
    .limit(1);
  const last = ((data ?? []) as { invoice_ref: string | null }[])[0]?.invoice_ref ?? "";
  const m = last.match(new RegExp(`^INV${stamp}(\\d+)$`));
  const next = (m ? parseInt(m[1], 10) : 0) + 1;
  return `INV${stamp}${pad2(next)}`;
}

/**
 * The quote's invoice number, assigning a fresh sequential one on first call and returning the
 * existing one thereafter. The conditional update (`invoice_ref is null`) + retry makes concurrent
 * first-generations converge on a single number rather than clobbering each other.
 */
export async function getOrAssignInvoiceRef(quoteId: number): Promise<string> {
  // System numbering (like quote/order ref-numbering) — always service_role: the global ref scan
  // must see all retailers' refs, and the write must succeed for public demo quotes (owner_id NULL,
  // which RLS would block). Page-level access is gated separately (canAccessOwned).
  const sb = admin();
  const read = async () => {
    const { data } = await sb.from("quotes").select("invoice_ref").eq("id", quoteId).maybeSingle();
    return (data as { invoice_ref: string | null } | null)?.invoice_ref ?? null;
  };

  const cur = await read();
  if (cur) return cur;

  for (let i = 0; i < 5; i++) {
    const ref = await nextInvoiceRef();
    const { error } = await sb
      .from("quotes")
      .update({ invoice_ref: ref })
      .eq("id", quoteId)
      .is("invoice_ref", null);
    if (!error) {
      const got = await read(); // our write, or a concurrent winner's
      if (got) return got;
    } else if ((error as { code?: string }).code !== "23505") {
      throw error; // 23505 = ref taken by another quote → recompute and retry
    }
  }
  // The loop can exhaust on a flaky connection where the write landed but the follow-up read
  // transiently failed — one last read recovers the already-assigned ref before we give up.
  const final = await read();
  if (final) return final;
  throw new Error("Could not assign invoice number");
}
