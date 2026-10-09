import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canAccessSettingsPath } from "@/lib/settings-access";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import Link from "next/link";
import { Blocks, KeyRound, Ruler, Users, Wallet } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const sections = [
  { href: "/settings/warehouse-units", icon: Ruler, title: "Единицы склада", description: "Обозначения единиц измерения номенклатуры — только для администратора" },
  { href: "/settings/product-percentages", icon: Wallet, title: "Проценты изделий", description: "Стандартные ставки новых изделий: инженер, сборщик и монтажник" },
  {
    href: "/settings/users",
    icon: Users,
    title: "Пользователи",
    description: "Сотрудники: ФИО, должность, контакты, роли, схемы оплаты",
  },
  {
    href: "/settings/payroll",
    icon: Wallet,
    title: "Зарплата",
    description: "Валюта зарплаты — единая для начислений и расчётников",
  },
  {
    href: "/settings/modules",
    icon: Blocks,
    title: "Модули",
    description: "Плагины системы: включение, настройки, команды, журнал запусков",
  },
  {
    href: "/settings/api",
    icon: KeyRound,
    title: "API и токены",
    description: "Токены доступа к REST API /api/v1 для плагинов и интеграций",
  },
];

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user || !canAccessSettingsPath(session.user.roles, "/settings")) redirect("/");
  const admin = hasAnyRole(session.user.roles, ADMIN_ROLES);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          {admin ? "Управление системой — доступно администратору и директору" : "Проценты новых изделий"}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.filter(section => canAccessSettingsPath(session.user.roles, section.href)).map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full transition-colors hover:bg-accent/50">
              <CardHeader>
                <section.icon className="mb-2 size-6 text-muted-foreground" />
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
