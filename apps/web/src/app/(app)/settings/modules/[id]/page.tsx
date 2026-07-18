import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { prisma } from "@/lib/prisma";
import { getManifest } from "@/server/plugins/registry";
import { getPluginSettings } from "@/server/plugins/run-log";

import { CommandButton } from "./command-button";
import { PluginToggle } from "../plugin-toggle";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

// Настройки → Модули → детальная страница модуля (§14).
export default async function ModuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plugin = await prisma.plugin.findUnique({ where: { id } });
  const manifest = getManifest(id);
  if (!plugin || !manifest) notFound();

  const [settings, runLogs] = await Promise.all([
    getPluginSettings(id),
    prisma.pluginRunLog.findMany({
      where: { pluginId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/settings/modules"
            className="text-muted-foreground hover:text-foreground"
            aria-label="К списку модулей"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{plugin.name}</h1>
              <Badge variant="secondary">v{plugin.version}</Badge>
              <Badge variant="outline">API {plugin.apiVersion}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {plugin.description}
            </p>
          </div>
        </div>
        <PluginToggle pluginId={plugin.id} enabled={plugin.enabled} />
      </div>

      {manifest.settingsSchema && manifest.settingsSchema.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Настройки модуля</CardTitle>
            <CardDescription>
              Форма собрана автоматически по settingsSchema манифеста
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SettingsForm
              pluginId={plugin.id}
              schema={manifest.settingsSchema}
              values={settings}
            />
            <PluginSlot slot="settings.page" props={{}} />
          </CardContent>
        </Card>
      ) : null}

      {manifest.commands && manifest.commands.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Команды</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {manifest.commands.map((command) => (
              <CommandButton
                key={command.id}
                pluginId={plugin.id}
                commandId={command.id}
                name={command.name}
                description={command.description}
                disabled={!plugin.enabled}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Журнал запусков</CardTitle>
          <CardDescription>Последние 50 записей</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Время</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Имя</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Сообщение</TableHead>
                <TableHead className="text-right">мс</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {log.createdAt.toLocaleString("ru-RU")}
                  </TableCell>
                  <TableCell>{log.kind}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {log.ref ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={log.status === "ok" ? "secondary" : "destructive"}
                    >
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 truncate">
                    {log.message ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {log.durationMs ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {runLogs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    Запусков пока не было
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Separator className="opacity-0" />
    </div>
  );
}
