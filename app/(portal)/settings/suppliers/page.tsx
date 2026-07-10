import { redirect } from "next/navigation";

/** Suppliers moved into the Settings tabs (Settings → Suppliers). Keep the old URL working. */
export default function SuppliersPage() {
  redirect("/settings?tab=suppliers");
}
