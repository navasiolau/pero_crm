import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canReadLogisticsDocuments } from "@/lib/logistics-access";
import { homePathForRoles } from "@/lib/home-route";
import { LogisticsWorkspace } from "@/components/logistics/workspace";
import { logisticsQueryFromParams, type SearchValues } from "@/components/logistics/model";
import { loadLogisticsWorkspace } from "./workspace-data";

export const dynamic = "force-dynamic";

export default async function LogisticsPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canReadLogisticsDocuments(session.user.roles)) redirect(homePathForRoles(session.user.roles));
  const params = await searchParams;
  const data = await loadLogisticsWorkspace(logisticsQueryFromParams(params), undefined, typeof params.trip === "string" ? params.trip : undefined);
  return <LogisticsWorkspace key={data.mode + ":" + (data.initialTrip?.id ?? "list")} data={data} />;
}
