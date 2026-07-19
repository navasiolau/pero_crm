"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { Project } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/lib/format";
import { stageLabels } from "@/lib/stages";
import { updateProject } from "@/server/projects/actions";

import type { SelectOption } from "../projects-view";

// Вкладка «Общее»: просмотр + редактирование по правам (§4).
export function OverviewTab({
  project,
  canManage,
  canEditTech,
  showAmount,
  clients,
  managers,
}: {
  project: Project & { client: { name: string; phone: string } };
  canManage: boolean;
  canEditTech: boolean;
  showAmount: boolean;
  clients: SelectOption[];
  managers: SelectOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    title: project.title,
    expectedPrice: project.expectedPrice?.toString() ?? "",
    address: project.address ?? "",
    description: project.description ?? "",
    clientId: project.clientId,
    managerId: project.managerId ?? "",
  });

  function set(key: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  const ro = !canManage; // read-only для не-менеджеров (кроме тех. блока)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Данные проекта</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Этап</Label>
            <Input value={stageLabels[project.stage]} disabled />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Изделие / описание</Label>
            <Input id="title" value={form.title} onChange={set("title")} readOnly={ro} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Клиент</Label>
            <SearchableSelect
              options={clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              value={form.clientId}
              onChange={(value) => setForm((prev) => ({ ...prev, clientId: value }))}
              placeholder="Выберите клиента…"
              searchPlaceholder="Поиск клиента…"
              disabled={ro}
            />
            <p className="text-xs text-muted-foreground">
              Телефон: {project.client.phone}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="price">
                Ожидаемая цена{showAmount ? `, ${project.currency}` : ""}
              </Label>
              {showAmount ? (
                <Input
                  id="price"
                  type="number"
                  min="0"
                  value={form.expectedPrice}
                  onChange={set("expectedPrice")}
                  readOnly={ro}
                />
              ) : (
                <Input value="скрыто правами" disabled />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Менеджер</Label>
              <SearchableSelect
                options={managers.map((manager) => ({
                  value: manager.id,
                  label: manager.name,
                }))}
                value={form.managerId}
                onChange={(value) => setForm((prev) => ({ ...prev, managerId: value }))}
                placeholder="не назначен"
                searchPlaceholder="Поиск менеджера…"
                allowClear
                disabled={ro}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">Адрес</Label>
            <Input id="address" value={form.address} onChange={set("address")} readOnly={ro} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Технический блок</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={set("description")}
              readOnly={!canEditTech}
              placeholder="Материалы, размеры, особенности…"
            />
            <p className="text-xs text-muted-foreground">
              Тех. блок правит и инженер (§4)
            </p>
          </div>
          {canManage || canEditTech ? (
            <div>
              <Button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const price = form.expectedPrice.trim();
                    const result = await updateProject(project.id, {
                      title: form.title.trim(),
                      expectedPrice: price === "" ? null : Number(price),
                      address: form.address.trim() || null,
                      description: form.description.trim() || null,
                      clientId: form.clientId,
                      managerId: form.managerId || null,
                    });
                    if (result.ok) {
                      toast.success("Сохранено");
                    } else {
                      toast.error(result.error ?? "Ошибка сохранения");
                    }
                  })
                }
              >
                {pending ? "Сохранение…" : "Сохранить"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Служебные данные</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Номер:</span> {project.number}
          </div>
          <div>
            <span className="text-muted-foreground">На этапе с:</span>{" "}
            {new Date(project.stageChangedAt).toLocaleString("ru-RU")}
          </div>
          <div>
            <span className="text-muted-foreground">Создан:</span>{" "}
            {new Date(project.createdAt).toLocaleString("ru-RU")}
          </div>
          {showAmount ? (
            <div>
              <span className="text-muted-foreground">Ожидаемая цена:</span>{" "}
              {formatAmount(project.expectedPrice?.toString() ?? null, project.currency)}
            </div>
          ) : null}
          {project.stage === "REFUSED" ? (
            <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <div className="font-medium">Отказ</div>
              <div>Причина: {project.refusalReason}</div>
              <div className="text-muted-foreground">{project.refusalComment}</div>
            </div>
          ) : null}
          {project.stage === "RECLAMATION" ? (
            <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="font-medium">Рекламация</div>
              <div>Причина: {project.reclamationReason}</div>
              <div className="text-muted-foreground">{project.reclamationDescription}</div>
              <div>Виновная сторона: {project.reclamationFault}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
