import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { QuoteDetails, SavedAddress } from "@/lib/types";
import { sanitizeContacts, sanitizeEmails } from "@/lib/contacts";

// profile_addresses ↔ SavedAddress column aliases (snake → camel on read).
const ADDRESS_COLS =
  "id, label, isDefault:is_default, customerName:customer_name, customerPhone:customer_phone, " +
  "customerEmail:customer_email, customerEmails:customer_emails, shipAddress1:ship_address1, shipAddress2:ship_address2, " +
  "shipCity:ship_city, shipState:ship_state, shipZip:ship_zip, po, sidemark, projectName:project_name, contacts";

// The QuoteDetails keys an address row actually stores (everything but quoteType/quoteName).
const ADDRESS_DETAIL_KEYS: (keyof QuoteDetails)[] = [
  "customerName", "customerPhone", "customerEmail", "customerEmails", "shipAddress1", "shipAddress2",
  "shipCity", "shipState", "shipZip", "po", "sidemark", "projectName", "contacts",
];
const ADDRESS_COLUMN: Partial<Record<keyof QuoteDetails, string>> = {
  customerName: "customer_name", customerPhone: "customer_phone", customerEmail: "customer_email",
  customerEmails: "customer_emails", shipAddress1: "ship_address1", shipAddress2: "ship_address2",
  shipCity: "ship_city", shipState: "ship_state", shipZip: "ship_zip", po: "po", sidemark: "sidemark",
  projectName: "project_name", contacts: "contacts",
};

/** Map QuoteDetails → address columns (only keys present; strings clamped, contacts sanitized). */
function addressColumns(d: QuoteDetails): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const k of ADDRESS_DETAIL_KEYS) {
    if (d[k] === undefined) continue;
    if (k === "contacts") {
      c.contacts = sanitizeContacts(d[k]); // jsonb array, never stringified
      continue;
    }
    if (k === "customerEmails") {
      c.customer_emails = sanitizeEmails(d[k]); // jsonb array, never stringified
      continue;
    }
    const v = d[k];
    c[ADDRESS_COLUMN[k]!] = v == null || v === "" ? null : String(v).slice(0, 500);
  }
  return c;
}

/** The owner's default address mapped to QuoteDetails (customer + ship-to + references), or null.
 *  Used to pre-fill a newly created quote. */
export async function getDefaultAddressDetails(
  ownerId: string,
  sb: SupabaseClient = admin()
): Promise<QuoteDetails | null> {
  const { data, error } = await sb
    .from("profile_addresses")
    .select(ADDRESS_COLS)
    .eq("owner_id", ownerId)
    .eq("is_default", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const a = data as unknown as SavedAddress;
  return {
    customerName: a.customerName ?? null,
    customerPhone: a.customerPhone ?? null,
    customerEmail: a.customerEmail ?? null,
    customerEmails: a.customerEmails ?? [],
    shipAddress1: a.shipAddress1 ?? null,
    shipAddress2: a.shipAddress2 ?? null,
    shipCity: a.shipCity ?? null,
    shipState: a.shipState ?? null,
    shipZip: a.shipZip ?? null,
    po: a.po ?? null,
    sidemark: a.sidemark ?? null,
    projectName: a.projectName ?? null,
    contacts: a.contacts ?? [],
  };
}

/** A retailer's saved addresses — default first, then most-recently-updated. */
export async function listAddresses(
  ownerId: string,
  sb: SupabaseClient = admin()
): Promise<SavedAddress[]> {
  const { data, error } = await sb
    .from("profile_addresses")
    .select(ADDRESS_COLS)
    .eq("owner_id", ownerId)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as SavedAddress[];
}

export async function createAddress(
  ownerId: string,
  details: QuoteDetails,
  label: string | null,
  isDefault: boolean,
  sb: SupabaseClient = admin()
): Promise<SavedAddress> {
  if (isDefault) await clearDefault(ownerId, sb);
  const { data, error } = await sb
    .from("profile_addresses")
    .insert({
      owner_id: ownerId,
      label: label?.trim() || null,
      is_default: isDefault,
      ...addressColumns(details),
    })
    .select(ADDRESS_COLS)
    .single();
  if (error) throw error;
  return data as unknown as SavedAddress;
}

export async function updateAddress(
  id: string,
  ownerId: string,
  details: QuoteDetails,
  label: string | null,
  isDefault: boolean,
  sb: SupabaseClient = admin()
): Promise<void> {
  if (isDefault) await clearDefault(ownerId, sb);
  const { error } = await sb
    .from("profile_addresses")
    .update({
      label: label?.trim() || null,
      is_default: isDefault,
      ...addressColumns(details),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}

export async function deleteAddress(
  id: string,
  ownerId: string,
  sb: SupabaseClient = admin()
): Promise<void> {
  const { error } = await sb.from("profile_addresses").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

/** Mark one address default, clearing any prior default for the owner. */
export async function setDefaultAddress(
  id: string,
  ownerId: string,
  sb: SupabaseClient = admin()
): Promise<void> {
  await clearDefault(ownerId, sb);
  const { error } = await sb
    .from("profile_addresses")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function clearDefault(ownerId: string, sb: SupabaseClient): Promise<void> {
  await sb.from("profile_addresses").update({ is_default: false }).eq("owner_id", ownerId).eq("is_default", true);
}
