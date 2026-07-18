import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { syncPlugins } from "@/server/plugins/sync";

import { PluginToggle } from "./plugin-toggle";

export const dynamic = "force-dynamic";

// Настройки → Модули: список установленных плагинов (§14).
export default async function ModulesPage() {
  await syncPlugins();
  const plugins = await prisma.plugin.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Модули</h1>
        <p className="text-sm text-muted-foreground">
          Включение и настройка плагинов. Данные модулей при выключении не
          удаляются.
        </p>
      </div>
      <div className="grid gap-4">
        {plugins.map((plugin) => (
          <Card key={plugin.id}>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{plugin.name}</CardTitle>
                  <Badge variant="secondary">v{plugin.version}</Badge>
                  <Badge variant="outline">API {plugin.apiVersion}</Badge>
                </div>
                <CardDescription>{plugin.description}</CardDescription>
              </div>
              <PluginToggle pluginId={plugin.id} enabled={plugin.enabled} />
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="flex flex-wrap gap-1.5">
                {plugin.permissions.length > 0 ? (
                  plugin.permissions.map((permission) => (
                    <Badge key={permission} variant="outline">
                      {permission}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    без запрошенных прав
                  </span>
                )}
              </div>
              <Link
                href={`/settings/modules/${plugin.id}`}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                Подробнее <ChevronRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        ))}
        {plugins.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ни одного модуля не установлено.
          </p>
        ) : null}
      </div>
    </div>
  );
}
