import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { windowErpEnabled } from "@/lib/window/flags";

// Every Window ERP entry point lives under these prefixes; with the kill-switch off they all
// 404 here — one choke point covering pages and APIs alike (the per-page guards below it are
// then just defense in depth).
const WINDOW_ERP_PREFIXES = ["/window-products", "/window-catalog", "/window-crm", "/api/window"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!windowErpEnabled() && WINDOW_ERP_PREFIXES.some((p) => pathname.startsWith(p))) {
    return new NextResponse(null, { status: 404 });
  }
  return await updateSession(request);
}

export const config = {
  // Run on all routes except static assets and image files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
