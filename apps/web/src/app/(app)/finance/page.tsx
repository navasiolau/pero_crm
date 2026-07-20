import Link from "next/link";
import { Landmark, ReceiptText, Wallet } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Финансы (§11) — только администратор и директор (middleware + nav).
export default function FinancePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Финансы</h1>
        <p className="text-sm text-muted-foreground">
          Кассы, платежи с курсами НБ РБ, экономика проектов, зарплата
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <Link href="/finance/accounts">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <Landmark className="mb-2 size-6 text-muted-foreground" />
              <CardTitle>Кассы</CardTitle>
              <CardDescription>
                Кассы организации в своих валютах, остатки по операциям
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/finance/articles">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <ReceiptText className="mb-2 size-6 text-muted-foreground" />
              <CardTitle>Статьи расходов</CardTitle>
              <CardDescription>
                Справочник статей для расходов по проектам
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
