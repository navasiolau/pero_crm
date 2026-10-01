"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";
import { CashPayoutForm } from "./cash-payout-form";

type EmployeeOption = { id: string; name: string; position: string | null };
type CashAccountOption = { id: string; name: string; currency: string; active: boolean; balance: number };

export function AdvancePayoutDialog({
  open,
  onOpenChange,
  users,
  accounts,
  estimates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: EmployeeOption[];
  accounts: CashAccountOption[];
  estimates?: Record<string, number | null>;
}) {
  const [uncertain, setUncertain] = useState(false);
  function changeOpen(next: boolean) {
    if (!next && uncertain) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {open ? (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Выдать аванс</DialogTitle>
            <DialogDescription>Сумма указывается в валюте кассы. Перед подтверждением будут показаны валютные эквиваленты и курсы.</DialogDescription>
          </DialogHeader>
          <CashPayoutForm mode="ADVANCE" users={users} accounts={accounts} estimates={estimates} onUncertainChange={setUncertain} onClose={() => changeOpen(false)} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
