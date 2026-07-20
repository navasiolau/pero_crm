import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight, Boxes, ClipboardList } from "lucide-react";

import { auth } from "@/auth";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Склад (§12, фаза 6) — раздел офисных ролей (§4), работнику/монтажнику
// недоступен (в навигации скрыт, здесь — защита от прямого захода по URL).
export default async function WarehousePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER"].includes(session.user.role)
  ) {
    redirect("/");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Склад</h1>
        <p className="text-sm text-muted-foreground">
          Номенклатура материалов, остатки и движения по складу
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/warehouse/stock">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <Boxes className="mb-2 size-6 text-muted-foreground" />
              <CardTitle>Остатки</CardTitle>
              <CardDescription>
                Текущие остатки материалов, нехватка по проектам, приход на
                склад
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/warehouse/items">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <ClipboardList className="mb-2 size-6 text-muted-foreground" />
              <CardTitle>Номенклатура</CardTitle>
              <CardDescription>
                Справочник материалов и категорий, учётные цены, минимальные
                остатки
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/warehouse/movements">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <ArrowLeftRight className="mb-2 size-6 text-muted-foreground" />
              <CardTitle>Движения</CardTitle>
              <CardDescription>
                Приходы, списания на проекты и возвраты — журнал операций
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
