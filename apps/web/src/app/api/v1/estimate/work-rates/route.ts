import { prisma } from "@/lib/prisma";
import { isWorkRatesOnly } from "@/lib/estimate-rates";
import { verifyApiToken } from "@/server/plugins/tokens";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const token = await verifyApiToken(request.headers.get("authorization"), "work-rates");
  if (!token) return Response.json({ error: "Требуется действительный токен" }, { status: 401, headers });
  if (!isWorkRatesOnly(token.scopes)) {
    return Response.json({ error: "Требуется отдельный ключ чтения сдельного прайса" }, { status: 403, headers });
  }
  const rows = await prisma.priceItem.findMany({
    where: { active: true },
    orderBy: [{ id: "asc" }],
    select: { id: true, name: true, category: true, unit: true, price: true, updatedAt: true },
  });
  return Response.json({
    currency: "BYN",
    fetchedAt: new Date().toISOString(),
    rates: rows.map(({ price, ...row }) => ({ ...row, price: price.toFixed(2) })),
  }, { headers });
}
