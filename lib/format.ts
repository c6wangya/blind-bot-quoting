import type { OrderStatus } from "./types";

export const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export const fmtDate = (iso: string) =>
  new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const fmtDateTime = (iso: string) =>
  new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; description: string; tone: "slate" | "blue" | "amber" | "violet" | "teal" | "green" }
> = {
  submitted: { label: "Submitted", description: "Order file sent to supplier", tone: "slate" },
  acknowledged: { label: "Acknowledged", description: "Supplier confirmed, order no. issued", tone: "blue" },
  in_production: { label: "In Production", description: "Cutting & assembly underway", tone: "amber" },
  shipped: { label: "Shipped", description: "Handed to carrier, tracking issued", tone: "violet" },
  in_transit: { label: "In Transit", description: "Linehaul to destination", tone: "teal" },
  delivered: { label: "Delivered", description: "Signed for at destination", tone: "green" },
};

/** Display name for an order_event actor (retailer is shown as "You"). */
export const ACTOR_LABEL: Record<string, string> = {
  retailer: "You",
  supplier: "Supplier",
  logistics: "Logistics",
  system: "System",
};
