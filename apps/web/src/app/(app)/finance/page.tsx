import Link from "next/link";
import { Wallet } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Финансы (§11) — только администратор и директор (middleware + nav).
// Кассы, платежи и курсы НБ РБ — фаза 5; сейчас — зарплата (фаза 4).
export default function FinancePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Финансы</h1>
        <p className="text-sm text-muted-foreground">
          Кассы, платежи и курсы валют появятся в фазе 5
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/finance/payroll">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <Wallet className="mb-2 size-6 text-muted-foreground" />
              <CardTitle>Зарплата</CardTitle>
              <CardDescription>
                Начисления по сотрудникам, выплаты, закрытие месяца и экспорт CSV
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
