import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { UsersView } from "./users-view";

export const dynamic = "force-dynamic";

// Настройки → Пользователи (админ/директор, §4).
export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <UsersView
      users={users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        position: user.position,
        phone: user.phone,
        telegram: user.telegram,
        role: user.role,
        payScheme: user.payScheme,
        payPercent: user.payPercent?.toString() ?? null,
        active: user.active,
      }))}
      currentUserId={session.user.id}
    />
  );
}
