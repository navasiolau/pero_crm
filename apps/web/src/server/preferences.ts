import { prisma } from "@/lib/prisma";

// UI-предпочтения per user (§7): вид разделов (канбан/таблица) и пр.
export async function getUserPreference(
  userId: string,
  key: string,
): Promise<string | null> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key } },
  });
  return row?.value ?? null;
}

export async function setUserPreference(
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value },
  });
}
