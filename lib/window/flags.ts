// Master kill-switch for the entire Window ERP surface. Server-side env only (never
// NEXT_PUBLIC — the gate must not be client-inspectable):
//
//   WINDOW_ERP_ENABLED=true  → the Window ERP blade, pages, and APIs exist
//   unset / anything else    → nav hidden, every /window-* page and /api/window/* route 404s,
//                              the quote-items window branch rejects — indistinguishable from
//                              the feature not existing.
//
// This is deliberately a SECOND layer on top of the per-surface gates (admin-only pages,
// dealerWindowAccess org flag): production leaves the env unset while the ERP is being
// polished, so merging to the deploy branch ships zero visible change.
export function windowErpEnabled(): boolean {
  return process.env.WINDOW_ERP_ENABLED === "true";
}
