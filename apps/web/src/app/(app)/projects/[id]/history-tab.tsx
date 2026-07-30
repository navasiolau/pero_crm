import type { ProductStatus, ProjectStage } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { productStatusLabels } from "@/lib/product-statuses";
import { stageLabels } from "@/lib/stages";

interface StageHistoryRow {
  id: string;
  fromStage: ProjectStage | null;
  toStage: ProjectStage;
  comment: string | null;
  createdAt: string;
  changedByName: string;
}

interface ProductHistoryRow {
  id: string;
  productNumber: string;
  productTitle: string;
  fromStatus: ProductStatus | null;
  toStatus: ProductStatus;
  comment: string | null;
  createdAt: string;
  changedByName: string;
}

interface ChangeLogRow {
  id: string;
  actorName: string;
  actorType: string;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

// Вкладка «История»: история этапов проекта (§6) + история статусов
// изделий + локальный журнал изменений (§5).
export function HistoryTab({
  stageHistory,
  productHistory,
  changeLogs,
}: {
  stageHistory: StageHistoryRow[];
  productHistory: ProductHistoryRow[];
  changeLogs: ChangeLogRow[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">История этапов проекта</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {stageHistory.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
              <div className="text-sm">
                {entry.fromStage ? (
                  <>
                    {stageLabels[entry.fromStage]} →{" "}
                    <Badge variant="secondary">{stageLabels[entry.toStage]}</Badge>
                  </>
                ) : (
                  <>
                    Создан:{" "}
                    <Badge variant="secondary">{stageLabels[entry.toStage]}</Badge>
                  </>
                )}
              </div>
              {entry.comment ? (
                <div className="text-sm text-muted-foreground">{entry.comment}</div>
              ) : null}
              <div className="text-xs text-muted-foreground">
                {entry.changedByName} ·{" "}
                {new Date(entry.createdAt).toLocaleString("ru-RU")}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">История статусов изделий</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {productHistory.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
              <div className="text-sm">
                <span className="text-muted-foreground">{entry.productNumber}</span>{" "}
                {entry.fromStatus ? (
                  <>
                    {productStatusLabels[entry.fromStatus]} →{" "}
                    <Badge variant="secondary">
                      {productStatusLabels[entry.toStatus]}
                    </Badge>
                  </>
                ) : (
                  <>
                    Создано:{" "}
                    <Badge variant="secondary">
                      {productStatusLabels[entry.toStatus]}
                    </Badge>
                  </>
                )}
              </div>
              {entry.comment ? (
                <div className="text-sm text-muted-foreground">{entry.comment}</div>
              ) : null}
              <div className="text-xs text-muted-foreground">
                {entry.changedByName} ·{" "}
                {new Date(entry.createdAt).toLocaleString("ru-RU")}
              </div>
            </div>
          ))}
          {productHistory.length === 0 ? (
            <div className="text-sm text-muted-foreground">Изделий пока нет</div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">Журнал изменений</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {changeLogs.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
              <div className="text-sm">
                {entry.action}
                {entry.field ? (
                  <span className="text-muted-foreground"> ({entry.field})</span>
                ) : null}
                {": "}
                <span className="text-muted-foreground">{formatValue(entry.oldValue)}</span>
                {" → "}
                <span>{formatValue(entry.newValue)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {entry.actorName} ·{" "}
                {new Date(entry.createdAt).toLocaleString("ru-RU")}
              </div>
            </div>
          ))}
          {changeLogs.length === 0 ? (
            <div className="text-sm text-muted-foreground">Записей пока нет</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
