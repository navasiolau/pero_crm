import { prisma } from "@/lib/prisma";

export async function assertRestrictedRuntimeDatabase() {
  if (process.env.PERO_DB_ENFORCE_RUNTIME !== "1") return;
  if (process.env.DATABASE_MIGRATION_URL || process.env.DB_PASSWORD) {
    throw new Error("Учётные данные мигратора недопустимы в ограниченном процессе CRM");
  }
  const rows = await prisma.$queryRaw<{ violations: string[] }[]>`SELECT public.pero_runtime_role_violations() AS violations`;
  if (rows.length !== 1 || !Array.isArray(rows[0].violations) || rows[0].violations.length) {
    throw new Error("Роль PostgreSQL не соответствует ограничениям CRM");
  }
}
