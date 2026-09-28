import { prisma } from "@/lib/prisma";
import { databaseHealth } from "@/server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return databaseHealth(() => prisma.$queryRaw`SELECT 1`);
}
