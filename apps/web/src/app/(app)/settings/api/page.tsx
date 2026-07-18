import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";

import { TokenManager } from "./token-manager";

export const dynamic = "force-dynamic";

const endpoints = [
  { method: "GET", path: "/api/v1", scope: "—", description: "Информация о сервисе и включённых модулях" },
  { method: "GET", path: "/api/v1/plugins", scope: "read", description: "Список модулей и их статус" },
  { method: "POST", path: "/api/v1/plugins/:id/commands/:command", scope: "write", description: "Запуск команды модуля" },
  { method: "GET", path: "/api/v1/events", scope: "read", description: "Последние доменные события шины" },
  { method: "POST", path: "/api/v1/events/dispatch", scope: "write", description: "Повторная доставка необработанных событий (cron)" },
  { method: "GET", path: "/api/v1/openapi.json", scope: "—", description: "OpenAPI-описание API" },
];

// Настройки → API и токены (§14: REST /api/v1 с токенами).
export default async function ApiSettingsPage() {
  const tokens = await prisma.apiToken.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">API и токены</h1>
        <p className="text-sm text-muted-foreground">
          REST API <code>/api/v1</code> для плагинов и внешних интеграций.
          Авторизация — заголовок <code>Authorization: Bearer pero_…</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Токены доступа</CardTitle>
          <CardDescription>
            Токен показывается один раз при создании — хранится только его
            хэш.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TokenManager
            tokens={tokens.map((token) => ({
              id: token.id,
              name: token.name,
              prefix: token.prefix,
              scopes: token.scopes,
              createdAt: token.createdAt.toISOString(),
              lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
              revokedAt: token.revokedAt?.toISOString() ?? null,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Методы API</CardTitle>
          <CardDescription>
            Машиночитаемое описание —{" "}
            <a
              href="/api/v1/openapi.json"
              target="_blank"
              className="underline underline-offset-2"
            >
              /api/v1/openapi.json
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Метод</TableHead>
                <TableHead>Путь</TableHead>
                <TableHead>Права</TableHead>
                <TableHead>Описание</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.map((endpoint) => (
                <TableRow key={endpoint.path}>
                  <TableCell>
                    <Badge variant="outline">{endpoint.method}</Badge>
                  </TableCell>
                  <TableCell>
                    <code>{endpoint.path}</code>
                  </TableCell>
                  <TableCell>{endpoint.scope}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {endpoint.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
