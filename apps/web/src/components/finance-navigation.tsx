import Link from "next/link";
import {
  ArrowDownLeft, ArrowUpRight, Banknote, ChartNoAxesColumnIncreasing, ChevronRight,
  FolderKanban, HandCoins, ReceiptText, Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const sections = [
  { href: "/finance/accounts/report", title: "Отчёт по кассам", icon: ChartNoAxesColumnIncreasing, group: "accounting",
    description: "Остатки и движение денег за период, зарплаты и авансы" },
  { href: "/finance/expenses", title: "Расходы организации", short: "Расходы", icon: ArrowUpRight, group: "money", direction: "expense",
    description: "Общие и проектные расходы по статьям с отчётными документами" },
  { href: "/finance/income", title: "Приходы организации", short: "Приходы", icon: ArrowDownLeft, group: "money", direction: "income",
    description: "Общие и проектные приходы в кассы" },
  { href: "/finance/projects", title: "Финансы проектов", icon: FolderKanban, group: "accounting",
    description: "Выбор проекта, приходы, расходы и экономика без общих и технических правок" },
  { href: "/finance/payroll", title: "Зарплата", icon: Wallet, group: "staff",
    description: "Начисления по сотрудникам, выплаты, закрытие месяца и экспорт CSV" },
  { href: "/finance/advances", title: "Авансы", icon: HandCoins, group: "staff",
    description: "Выдача аванса сотруднику из кассы организации" },
  { href: "/finance/accounts", title: "Кассы", icon: Banknote, group: "accounting",
    description: "Кассы организации в своих валютах, остатки по операциям" },
  { href: "/finance/articles", title: "Статьи расходов", icon: ReceiptText, group: "accounting",
    description: "Справочник статей для расходов по проектам" },
] as const;

const mobileGroups = [
  { id: "accounting", label: "Учёт" },
  { id: "staff", label: "Выплаты сотрудникам" },
] as const;

export function FinanceNavigation({ telegram, showPayroll }: { telegram: boolean; showPayroll: boolean }) {
  const visible = sections.filter(section => showPayroll || section.href !== "/finance/payroll");

  return (
    <div className={telegram ? "telegram-finance-overview" : "flex flex-col gap-6"}>
      <PageHeader title="Финансы" description={telegram ? undefined : "Кассы, платежи с курсами НБ РБ, экономика проектов, зарплата"} />
      {telegram ? <>
        <div className="telegram-finance-operations">
          {visible.filter(section => section.group === "money").map(({ href, short, icon: Icon, direction }) => (
            <Link key={href} href={href} data-direction={direction}>
              <Icon aria-hidden="true" />
              <span>{short}</span>
            </Link>
          ))}
        </div>
        {mobileGroups.map(group => (
          <section key={group.id} aria-labelledby={`telegram-finance-${group.id}`}>
            <h2 id={`telegram-finance-${group.id}`}>{group.label}</h2>
            <div className="telegram-finance-links">
              {visible.filter(section => section.group === group.id).map(({ href, title, icon: Icon }) => (
                <Link key={href} href={href}>
                  <span className="telegram-finance-link-icon"><Icon aria-hidden="true" /></span>
                  <span>{title}</span>
                  <ChevronRight aria-hidden="true" className="telegram-finance-link-chevron" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(({ href, title, icon: Icon, description }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:bg-accent/50">
              <CardHeader>
                <Icon aria-hidden="true" className="mb-2 size-6 text-muted-foreground" />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>}
    </div>
  );
}
