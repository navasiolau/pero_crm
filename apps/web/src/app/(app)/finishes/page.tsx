import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canManageFinishCatalog, canReadFinishCatalog } from "@/lib/finish-catalog-access";
import { listFinishesFor } from "@/server/finishes/queries";
import { FinishesView } from "./finishes-view";
export const dynamic = "force-dynamic";
export default async function FinishesPage() {
  const session = await auth(); if (!session?.user) redirect("/login");
  if (!canReadFinishCatalog(session.user.roles)) redirect("/");
  const rows = await listFinishesFor(session.user);
  return <FinishesView rows={rows} canManage={canManageFinishCatalog(session.user.roles)} />;
}
