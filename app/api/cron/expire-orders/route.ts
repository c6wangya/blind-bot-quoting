import { NextResponse } from "next/server";
import { getCurrentUserId, isAdmin } from "@/lib/auth/user";
import { expireStaleAwaitingOrders } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Expire abandoned awaiting-payment orders. Call from a scheduled job with
 * `?secret=<CRON_SECRET>`, or hit it as a signed-in admin. Returns { expired }.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = new URL(req.url).searchParams.get("secret");
  const authed = secret ? provided === secret : false;
  if (!authed) {
    const uid = await getCurrentUserId();
    if (!uid || !(await isAdmin(uid))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ expired: await expireStaleAwaitingOrders() });
}

export const GET = run;
export const POST = run;
