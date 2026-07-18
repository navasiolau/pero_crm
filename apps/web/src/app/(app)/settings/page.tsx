import Link from "next/link";
import { Blocks, KeyRound } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const sections = [
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

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          Управление системой — доступно администратору и директору
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
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
