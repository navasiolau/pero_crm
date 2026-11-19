import { redirect } from "next/navigation";
import { scopedFinanceAuth } from "@/server/telegram/finance-session";
import { canReadLogisticsDocuments } from "@/lib/logistics-access";
import { homePathForRoles } from "@/lib/home-route";

export const dynamic = "force-dynamic";
export default async function LogisticsTripLink({ params }: { params: Promise<{ id: string }> }) {
  const session = await scopedFinanceAuth();
  if (!session?.user) redirect("/login");
  if (!canReadLogisticsDocuments(session.user.roles)) redirect(homePathForRoles(session.user.roles));
  redirect("/logistics?trip=" + encodeURIComponent((await params).id));
}
