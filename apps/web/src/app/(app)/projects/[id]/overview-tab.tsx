"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { ProjectStage } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAmount } from "@/lib/format";
import { displayClientName } from "@/lib/labels";
import { stageLabels } from "@/lib/stages";
import { updateProject } from "@/server/projects/actions";

import type { SelectOption } from "../projects-view";

const CURRENCIES = ["BYN", "RUB", "USD", "EUR"];

export interface OverviewProject {
  id: string;
  number: string;
  title: string;
  stage: ProjectStage;
  stageChangedAt: Date;
  currency: string;
  address: string | null;
  clientId: string;
  managerId: string | null;
  createdAt: Date;
  refusalReason: string | null;
  refusalComment: string | null;
  reclamationReason: string | null;
  reclamationDescription: string | null;
  reclamationFault: string | null;
  client: { id: string; name: string; lastName: string | null; middleName: string | null; phone: string };
}

// Вкладка «Общее» карточки проекта: заказ (клиент, менеджер, адрес, валюта)
// + инженеры (по изделиям — read-only, назначаются в изделиях) + служебные
// данные. Цены — на изделиях (вкладка «Изделия»), сумма изделий показана
// справочно.
export function OverviewTab({
  project,
  totalPrice,
  totalInitialPrice,
  createdByName,
  doneAt,
  canManage,
  showAmount,
  clients,
  managers,
  productEngineers,
}: {
  project: OverviewProject;
  totalPrice: number;
  totalInitialPrice: number;
  createdByName: string | null;
  doneAt: string | null; // дата перехода в «Завершён» из истории этапов
  canManage: boolean;
  showAmount: boolean;
  clients: SelectOption[];
  managers: SelectOption[];
  productEngineers: SelectOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    title: project.title,
    address: project.address ?? "",
    currency: project.currency,
    clientId: project.clientId,
    managerId: project.managerId ?? "",
  });

  function set(key: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  const ro = !canManage; // read-only для не-менеджеров

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
            <Label htmlFor="title">Название заказа</Label>
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
              <Link href="/clients" className="underline-offset-2 hover:underline">
                {displayClientName(project.client)}
              </Link>
              {" · "}Телефон: {project.client.phone}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
            <div className="flex flex-col gap-1.5">
              <Label>Инженеры (по изделиям)</Label>
              <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm">
                {productEngineers.length > 0 ? (
                  productEngineers.map((engineer) => (
                    <Badge key={engineer.id} variant="secondary">
                      {engineer.name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Инженер назначается на конкретное изделие (вкладка «Изделия»);
                на него начисляется % от стоимости его изделий при переходе «В работе»
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address">Адрес</Label>
              <Input id="address" value={form.address} onChange={set("address")} readOnly={ro} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Валюта</Label>
              <Select
                value={form.currency}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, currency: value ?? "BYN" }))
                }
                disabled={ro}
              >
                <SelectTrigger>
                  <SelectValue>{form.currency}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {canManage ? (
            <div>
              <Button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await updateProject(project.id, {
                      title: form.title.trim(),
                      address: form.address.trim() || null,
                      currency: form.currency,
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
            {createdByName ? ` · ${createdByName}` : ""}
          </div>
          {doneAt ? (
            <div>
              <span className="text-muted-foreground">Завершён:</span>{" "}
              {new Date(doneAt).toLocaleString("ru-RU")}
            </div>
          ) : null}
          {showAmount ? (
            <div>
              <span className="text-muted-foreground">Сумма изделий:</span>{" "}
              {formatAmount(totalPrice > 0 ? String(totalPrice) : null, project.currency)}
            </div>
          ) : null}
          {showAmount ? (
            <div>
              <span className="text-muted-foreground">Первоначальная цена:</span>{" "}
              {formatAmount(
                totalInitialPrice > 0 ? String(totalInitialPrice) : null,
                project.currency,
              )}
              <span className="text-xs text-muted-foreground">
                {" "}
                · сумма по изделиям
              </span>
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
