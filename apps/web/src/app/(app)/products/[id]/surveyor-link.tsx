"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SurveyorInfo {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
}

// Замерщик в карточке изделия: показывается ФИО, клик — карточка сотрудника.
export function SurveyorLink({ surveyor }: { surveyor: SurveyorInfo }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="link"
        className="h-auto p-0 text-foreground underline-offset-2 hover:underline"
        onClick={() => setOpen(true)}
      >
        <UserRound className="size-4" />
        {surveyor.name}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{surveyor.name}</DialogTitle>
            <DialogDescription>Карточка сотрудника · замерщик</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-muted-foreground">Должность</div>
              <div>{surveyor.position ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Телефон</div>
              <div>{surveyor.phone ?? "—"}</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
