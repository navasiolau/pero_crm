"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectStage } from "@prisma/client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface StageFormRequest {
  projectId: string;
  fromStage: ProjectStage;
  toStage: ProjectStage;
}

export interface StageFormValues {
  refusalReason?: string;
  refusalComment?: string;
  reclamationReason?: string;
  reclamationDescription?: string;
  reclamationFault?: string;
}

// Обязательные сведения нового перехода; введённые данные сохраняются при отмене.

export function StageFormDialog({
  request,
  onClose,
  onSubmit, errors = {},
}: {
  request: StageFormRequest | null; errors?: Record<string,string>;
  onClose: () => void;
  onSubmit: (
    request: StageFormRequest,
    values: StageFormValues,
  ) => Promise<boolean>;
}) {
  const [values, setValues] = useState<StageFormValues>({});
  const [pending, setPending] = useState(false);

  const drafts = useRef<Record<string,StageFormValues>>({});
  const key=request ? `${request.projectId}:${request.toStage}` : null;
  useEffect(()=>{if(key)setValues(drafts.current[key]??{})},[key]);

  if (!request) return null;
  const isRefusal = request.toStage === "REFUSED";

  function field(key: keyof StageFormValues) {
    return (event: { target: { value: string } }) =>
      setValues((prev) => {const next={ ...prev, [key]: event.target.value }; drafts.current[`${request!.projectId}:${request!.toStage}`]=next; return next;});
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isRefusal ? "Отказ по проекту" : "Открыть рекламацию"}
          </DialogTitle>
          <DialogDescription>
            {isRefusal
              ? "Укажите причину отказа. Комментарий необязателен."
              : "Укажите причину, описание и виновную сторону."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {isRefusal ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="refusalReason">Причина отказа</Label>
                <Input
                  id="refusalReason"
                  value={values.refusalReason ?? ""}
                  onChange={field("refusalReason")}
                  placeholder="Например: дорого"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="refusalComment">Комментарий</Label>
                <Textarea
                  id="refusalComment"
                  value={values.refusalComment ?? ""}
                  onChange={field("refusalComment")}
                  placeholder="Детали: что предлагали, что ответил клиент…"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reclamationReason">Причина</Label>
                <Input
                  id="reclamationReason"
                  value={values.reclamationReason ?? ""}
                  onChange={field("reclamationReason")}
                  placeholder="Например: скол на фасаде"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reclamationDescription">Описание</Label>
                <Textarea
                  id="reclamationDescription"
                  value={values.reclamationDescription ?? ""}
                  onChange={field("reclamationDescription")}
                  placeholder="Что случилось, что требуется сделать…"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reclamationFault">Виновная сторона</Label>
                <Input
                  id="reclamationFault"
                  value={values.reclamationFault ?? ""}
                  onChange={field("reclamationFault")}
                  placeholder="Цех / монтаж / клиент / поставщик…"
                />
              </div>
            </>
          )}
        </div>

        {Object.entries(errors).map(([key,message])=><p key={key} role="alert" className="text-sm text-destructive">{message}</p>)}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try { if(await onSubmit(request, values)) delete drafts.current[`${request.projectId}:${request.toStage}`]; } finally { setPending(false); }
            }}
          >
            {pending
              ? "Сохранение…"
              : isRefusal
                ? "Перевести в «Отказ»"
                : "Открыть рекламацию"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
