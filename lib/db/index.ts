// Single data-access layer for the quote service. Split into cohesive submodules; this
// barrel preserves the public `@/lib/db` surface so every call site stays unchanged.
//
//   catalog    — static catalog accessors (no DB)
//   profile    — retailer profile read
//   ownership  — quote/order owner lookups (RLS guards)
//   pricing    — pricing-version reads
//   quotes     — quote + quote_item reads/writes
//   orders     — order + order_event reads/writes, pre-order submission
//   tags       — admin-managed accessory attributes/values + per-model tagging
//
// Internals (seed, column constants, round2, nextRef) live in seed.ts / internal.ts and
// are intentionally NOT re-exported here.
export * from "./catalog";
export * from "./profile";
export * from "./ownership";
export * from "./pricing";
export * from "./quotes";
export * from "./orders";
export * from "./tags";
