import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";

// THE-772 — admin-managed app settings (key/value). Currently: company bank-transfer details
// shown to a retailer who pays by bank transfer. Public-read (signed-in), admin-write via RLS.

export type BankInfo = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  routingNumber: string;
  swift: string;
  instructions: string;
};

const EMPTY_BANK: BankInfo = {
  bankName: "",
  accountName: "",
  accountNumber: "",
  routingNumber: "",
  swift: "",
  instructions: "",
};
const BANK_KEY = "bank_transfer";

export async function getBankInfo(sb: SupabaseClient = admin()): Promise<BankInfo> {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", BANK_KEY).maybeSingle();
  if (error) return EMPTY_BANK; // table not present yet (0011 not run) → no details
  return { ...EMPTY_BANK, ...((data?.value as Partial<BankInfo>) ?? {}) };
}

export async function setBankInfo(info: BankInfo, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb
    .from("app_settings")
    .upsert({ key: BANK_KEY, value: info, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// The "from"/ship-from party printed on invoices & purchase orders (top-left block). Editable by an
// admin; overrides the env/brand defaults in lib/invoice.ts when set. Empty fields fall back.
export type SellerInfo = {
  name: string;
  /** address lines, top to bottom (e.g. street, suite, city/state/zip, country) */
  addressLines: string[];
  taxId: string;
};

const EMPTY_SELLER: SellerInfo = { name: "", addressLines: [], taxId: "" };
const SELLER_KEY = "invoice_seller";

export async function getSellerInfo(sb: SupabaseClient = admin()): Promise<SellerInfo> {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", SELLER_KEY).maybeSingle();
  if (error) return EMPTY_SELLER; // table not present yet → fall back to env/brand defaults
  const v = (data?.value as Partial<SellerInfo>) ?? {};
  return {
    name: v.name ?? "",
    addressLines: Array.isArray(v.addressLines) ? v.addressLines.filter((l): l is string => typeof l === "string") : [],
    taxId: v.taxId ?? "",
  };
}

export async function setSellerInfo(info: SellerInfo, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb
    .from("app_settings")
    .upsert({ key: SELLER_KEY, value: info, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---------------- purchase-order parties ----------------
// A purchase order is issued to a supplier (a brand: A-OK / B-OK …); the parties printed on it are
// NOT the customer-facing invoice seller. The BUYER is our real purchasing entity (e.g. Quarvia
// Trade) — distinct from the white-label brand shown to retailers. The SELLER/VENDOR is the
// supplier, whose full company header + bank details differ per brand. Both stored in app_settings.

/** The buyer block printed on every purchase order — our real purchasing company (not the brand). */
export type BuyerInfo = {
  name: string;
  /** contact person ("Attn:" on the reference PO) */
  attn: string;
  addressLines: string[];
  tel: string;
  email: string;
};

const EMPTY_BUYER: BuyerInfo = { name: "", attn: "", addressLines: [], tel: "", email: "" };
const BUYER_KEY = "po_buyer";

export async function getBuyerInfo(sb: SupabaseClient = admin()): Promise<BuyerInfo> {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", BUYER_KEY).maybeSingle();
  if (error) return EMPTY_BUYER; // table not present yet → no details
  const v = (data?.value as Partial<BuyerInfo>) ?? {};
  return {
    name: v.name ?? "",
    attn: v.attn ?? "",
    addressLines: Array.isArray(v.addressLines) ? v.addressLines.filter((l): l is string => typeof l === "string") : [],
    tel: v.tel ?? "",
    email: v.email ?? "",
  };
}

export async function setBuyerInfo(info: BuyerInfo, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb
    .from("app_settings")
    .upsert({ key: BUYER_KEY, value: info, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** One supplier's full company header + bank details, keyed by brand id. Printed on that brand's PO. */
export type SupplierInfo = {
  name: string;
  addressLines: string[];
  tel: string;
  fax: string;
  website: string;
  /** bank block (Beneficiary's Bank Name / Swift / Beneficiary's Name / A/C No. / bank address). */
  bankName: string;
  swift: string;
  beneficiary: string;
  accountNumber: string;
  bankAddress: string;
};

const EMPTY_SUPPLIER: SupplierInfo = {
  name: "",
  addressLines: [],
  tel: "",
  fax: "",
  website: "",
  bankName: "",
  swift: "",
  beneficiary: "",
  accountNumber: "",
  bankAddress: "",
};
const SUPPLIERS_KEY = "po_suppliers";

function normSupplier(v: Partial<SupplierInfo> | undefined): SupplierInfo {
  const s = v ?? {};
  return {
    ...EMPTY_SUPPLIER,
    ...s,
    addressLines: Array.isArray(s.addressLines) ? s.addressLines.filter((l): l is string => typeof l === "string") : [],
  };
}

/** All supplier profiles, keyed by brand id. Missing brands simply have no entry. */
export async function getSuppliers(sb: SupabaseClient = admin()): Promise<Record<string, SupplierInfo>> {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", SUPPLIERS_KEY).maybeSingle();
  if (error) return {};
  const raw = (data?.value as Record<string, Partial<SupplierInfo>>) ?? {};
  const out: Record<string, SupplierInfo> = {};
  for (const [brandId, v] of Object.entries(raw)) out[brandId] = normSupplier(v);
  return out;
}

/** One supplier profile by brand id (all-blank if unset). */
export async function getSupplierInfo(brandId: string, sb: SupabaseClient = admin()): Promise<SupplierInfo> {
  const all = await getSuppliers(sb);
  return all[brandId] ?? { ...EMPTY_SUPPLIER };
}

/** Upsert one brand's supplier profile, preserving the others. */
export async function setSupplierInfo(brandId: string, info: SupplierInfo, sb: SupabaseClient = admin()): Promise<void> {
  const all = await getSuppliers(sb);
  all[brandId] = normSupplier(info);
  const { error } = await sb
    .from("app_settings")
    .upsert({ key: SUPPLIERS_KEY, value: all, updated_at: new Date().toISOString() });
  if (error) throw error;
}
