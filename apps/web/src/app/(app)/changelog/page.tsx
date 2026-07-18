import { Badge } from "@/components/ui/badge";
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
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

const ACTOR_TYPE_LABELS: Record<string, string> = {
  user: "пользователь",
  plugin: "плагин",
  system: "система",
};

// Журнал изменений (§5): кто, что, когда, было → стало, источник.
// Доступ ограничен middleware (ADMIN/DIRECTOR).
export default async function ChangelogPage() {
  const entries = await prisma.changeLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Журнал изменений</h1>
        <p className="text-sm text-muted-foreground">
          Каждое действие в системе: кто, что, когда, было → стало, источник.
          Последние 100 записей.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Записи</CardTitle>
          <CardDescription>
            Фильтры по сотруднику, сущности и периоду появятся в фазе 2
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Время</TableHead>
                <TableHead>Кто</TableHead>
                <TableHead>Сущность</TableHead>
                <TableHead>Действие</TableHead>
                <TableHead>Было → стало</TableHead>
                <TableHead>Источник</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {entry.createdAt.toLocaleString("ru-RU")}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span>{entry.actorName ?? entry.actorId}</span>
                      <Badge variant="outline" className="w-fit">
                        {ACTOR_TYPE_LABELS[entry.actorType] ?? entry.actorType}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code>
                      {entry.entity}:{entry.entityId}
                    </code>
                  </TableCell>
                  <TableCell>
                    {entry.action}
                    {entry.field ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({entry.field})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-72">
                    <span className="text-muted-foreground">
                      {formatValue(entry.oldValue)}
                    </span>
                    {" → "}
                    <span>{formatValue(entry.newValue)}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{entry.source}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    Записей пока нет — они появятся при первых действиях
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
