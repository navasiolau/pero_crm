import Link from "next/link";
import { FolderKanban, HandCoins, Landmark, ReceiptText, Wallet } from "lucide-react";
import { PAYROLL_MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { requireFinance } from "@/server/require-role";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function FinancePage() {
  const session = await requireFinance();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Финансы</h1>
        <p className="text-sm text-muted-foreground">
          Кассы, платежи с курсами НБ РБ, экономика проектов, зарплата
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/finance/accounts/report"><Card className="h-full transition-colors hover:bg-accent/50"><CardHeader><Landmark className="mb-2 size-6 text-muted-foreground"/><CardTitle>Отчёт по кассам</CardTitle><CardDescription>Остатки и движение денег за период, зарплаты и авансы</CardDescription></CardHeader></Card></Link>
        <Link href="/finance/expenses"><Card className="h-full transition-colors hover:bg-accent/50"><CardHeader><ReceiptText className="mb-2 size-6 text-muted-foreground"/><CardTitle>Расходы организации</CardTitle><CardDescription>Общие и проектные расходы по статьям с отчётными документами</CardDescription></CardHeader></Card></Link>
        <Link href="/finance/income"><Card className="h-full transition-colors hover:bg-accent/50"><CardHeader><Landmark className="mb-2 size-6 text-muted-foreground"/><CardTitle>Приходы организации</CardTitle><CardDescription>Общие и проектные приходы в кассы</CardDescription></CardHeader></Card></Link>
        <Link href="/finance/projects"><Card className="h-full transition-colors hover:bg-accent/50"><CardHeader><FolderKanban className="mb-2 size-6 text-muted-foreground"/><CardTitle>Финансы проектов</CardTitle><CardDescription>Выбор проекта, приходы, расходы и экономика без общих и технических правок</CardDescription></CardHeader></Card></Link>
        {hasAnyRole(session.user.roles, PAYROLL_MANAGE_ROLES) && <Link href="/finance/payroll">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <Wallet className="mb-2 size-6 text-muted-foreground" />
              <CardTitle>Зарплата</CardTitle>
              <CardDescription>
                Начисления по сотрудникам, выплаты, закрытие месяца и экспорт CSV
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>}
        <Link href="/finance/advances">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <HandCoins className="mb-2 size-6 text-muted-foreground" />
              <CardTitle>Авансы</CardTitle>
              <CardDescription>
                Выдача аванса сотруднику из кассы организации
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
