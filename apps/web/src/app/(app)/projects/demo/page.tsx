import nextDynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SlotErrorBoundary } from "@/components/plugins/slot-error-boundary";
import { getPluginSettings } from "@/server/plugins/run-log";
import { getSlotContributions } from "@/server/plugins/slots";

export const dynamic = "force-dynamic";

const PROJECT_ID = "demo";

// Демо-проект: проверка слота project.tab (§14) — нативные вкладки плагинов
// внутри карточки проекта, без iframe. Полноценная карточка — фаза 2.
export default async function DemoProjectPage() {
  const contributions = await getSlotContributions("project.tab");
  const tabs = await Promise.all(
    contributions.map(async (contribution) => ({
      ...contribution,
      settings: await getPluginSettings(contribution.pluginId),
      Component: nextDynamic(contribution.loader) as ComponentType<{
        projectId: string;
        settings: Record<string, unknown>;
      }>,
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">П-2026-001 · Кухня «Модерн»</h1>
        <Badge variant="secondary">демо</Badge>
      </div>

      <Tabs defaultValue="main">
        <TabsList>
          <TabsTrigger value="main">Общее</TabsTrigger>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.pluginId} value={tab.pluginId}>
              {tab.pluginName}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="main" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Общее</CardTitle>
              <CardDescription>
                Демонстрационный проект для проверки плагинных вкладок
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Клиент:</span> Иванова
                Анна
              </div>
              <div>
                <span className="text-muted-foreground">Этап:</span> В работе
              </div>
              <div>
                <span className="text-muted-foreground">Изделие:</span> Кухня
                «Модерн»
              </div>
              <div>
                <span className="text-muted-foreground">Сумма:</span> 385 000 ₽
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {tabs.map((tab) => (
          <TabsContent
            key={tab.pluginId}
            value={tab.pluginId}
            className="mt-4"
          >
            <SlotErrorBoundary pluginName={tab.pluginName}>
              <tab.Component projectId={PROJECT_ID} settings={tab.settings} />
            </SlotErrorBoundary>
          </TabsContent>
        ))}
      </Tabs>

      {tabs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Ни один включённый модуль не даёт вкладку в проект. Включите
            демо-плагин в «Настройки → Модули» — здесь появится его нативная
            вкладка.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
