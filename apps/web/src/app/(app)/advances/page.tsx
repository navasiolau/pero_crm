import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { hasAnyRole, ADVANCE_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AdvancesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasAnyRole(session.user.roles, ADVANCE_ROLES)) redirect("/");

  redirect("/finance/advances");
}
