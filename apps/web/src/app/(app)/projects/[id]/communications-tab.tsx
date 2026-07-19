"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CommunicationType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { communicationTypeLabels } from "@/lib/labels";
import { addCommunication } from "@/server/communications/actions";

export interface CommunicationRow {
  id: string;
  type: CommunicationType;
  text: string;
  happenedAt: string;
  authorName: string;
}

// Вкладка «Коммуникации»: лента контактов по проекту (§4).
export function CommunicationsTab({
  projectId,
  entries,
  canEdit,
}: {
  projectId: string;
  entries: CommunicationRow[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<CommunicationType>("CALL");
  const [text, setText] = useState("");

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex gap-3">
              <Select
                value={type}
                onValueChange={(value) => setType((value ?? "CALL") as CommunicationType)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue>{communicationTypeLabels[type]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(communicationTypeLabels).map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Итог разговора, договорённости…"
            />
            <div>
              <Button
                disabled={!text.trim() || pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await addCommunication({
                      projectId,
                      type,
                      text: text.trim(),
                    });
                    if (result.ok) {
                      toast.success("Запись добавлена");
                      setText("");
                    } else {
                      toast.error(result.error ?? "Ошибка");
                    }
                  })
                }
              >
                Добавить запись
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <Card key={entry.id}>
            <CardContent className="flex flex-col gap-1 p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {communicationTypeLabels[entry.type]} · {entry.authorName}
                </span>
                <span>{new Date(entry.happenedAt).toLocaleString("ru-RU")}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{entry.text}</div>
            </CardContent>
          </Card>
        ))}
        {entries.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Коммуникаций пока нет
          </div>
        ) : null}
      </div>
    </div>
  );
}
