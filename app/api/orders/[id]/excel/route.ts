import { canAccessOwned, getCurrentUserId } from "@/lib/auth/user";
import { getOrderOwnerId } from "@/lib/db";
import { buildOrderWorkbook } from "@/lib/excel";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const uid = await getCurrentUserId();
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessOwned(uid, await getOrderOwnerId(Number(id))))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const { buffer, filename } = await buildOrderWorkbook(Number(id));
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
