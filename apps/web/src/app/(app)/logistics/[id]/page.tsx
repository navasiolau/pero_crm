import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canReadLogisticsDocuments } from "@/lib/logistics-access";
import { homePathForRoles } from "@/lib/home-route";

export const dynamic = "force-dynamic";
export default async function LogisticsTripLink({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canReadLogisticsDocuments(session.user.roles)) redirect(homePathForRoles(session.user.roles));
  redirect("/logistics?trip=" + encodeURIComponent((await params).id));
}
