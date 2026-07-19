import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/prisma";

import { ChangelogTable } from "./changelog-table";

export const dynamic = "force-dynamic";

// Журнал изменений (§5): фильтры по сотруднику, сущности, периоду.
// Доступ ограничен middleware (ADMIN/DIRECTOR).
export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; entity?: string; from?: string; to?: string }>;
}) {
  const { actor, entity, from, to } = await searchParams;

  const where = {
    ...(actor
      ? {
          OR: [
            { actorName: { contains: actor, mode: "insensitive" as const } },
            { actorId: { contains: actor, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(entity ? { entity: { contains: entity, mode: "insensitive" as const } } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const entries = await prisma.changeLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Журнал изменений</h1>
        <p className="text-sm text-muted-foreground">
          Каждое действие в системе: кто, что, когда, было → стало, источник.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Записи ({entries.length})</CardTitle>
          <CardDescription>До 200 последних по фильтру</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-wrap items-end gap-3" action="/changelog">
            <div className="flex flex-col gap-1">
              <label htmlFor="actor" className="text-xs text-muted-foreground">
                Сотрудник / автор
              </label>
              <Input
                id="actor"
                name="actor"
                defaultValue={actor ?? ""}
                placeholder="Имя или id"
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="entity" className="text-xs text-muted-foreground">
                Сущность
              </label>
              <Input
                id="entity"
                name="entity"
                defaultValue={entity ?? ""}
                placeholder="project, task, plugin…"
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="from" className="text-xs text-muted-foreground">
                С
              </label>
              <Input id="from" name="from" type="date" defaultValue={from ?? ""} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="to" className="text-xs text-muted-foreground">
                По
              </label>
              <Input id="to" name="to" type="date" defaultValue={to ?? ""} />
            </div>
            <Button type="submit" variant="outline">
              Применить
            </Button>
            <Button
              type="submit"
              variant="ghost"
              formAction="/changelog"
              name="reset"
              value="1"
            >
              Сбросить
            </Button>
          </form>

          <ChangelogTable
            entries={entries.map((entry) => ({
              id: entry.id,
              createdAt: entry.createdAt.toISOString(),
              actorName: entry.actorName ?? entry.actorId,
              actorType: entry.actorType,
              entity: entry.entity,
              entityId: entry.entityId,
              action: entry.action,
              field: entry.field,
              oldValue: entry.oldValue,
              newValue: entry.newValue,
              source: entry.source,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
