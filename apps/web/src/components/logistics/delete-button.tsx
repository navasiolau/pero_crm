"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { createRequestId } from "@/lib/request-id";
import { formatDate, formatExactMoney } from "@/lib/format";
import { deleteLogisticsTrip } from "@/server/logistics/delete-actions";
import type { LogisticsTripDeleteInput } from "@/server/logistics/delete-contracts";
import type { ManagedTrip } from "./types";

export function LogisticsDeleteButton({ trip, onDeleted }: { trip: ManagedTrip; onDeleted: () => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const request = useRef<LogisticsTripDeleteInput | null>(null), busy = useRef(false);
  const current = trip.money.current;
  async function confirm() {
    if (busy.current) return false;
    request.current ??= { tripId: trip.id, expectedRevision: trip.revision, clientMutationId: createRequestId() };
    busy.current = true; setError("");
    try {
      const result = await deleteLogisticsTrip(request.current);
      if (!result.ok) { request.current = null; setError(result.error); return false; }
      request.current = null; onDeleted(); return true;
    } catch {
      setError("Ответ не получен. Повторите удаление: будет подтверждён тот же запрос."); return false;
    } finally { busy.current = false; }
  }
  return <div onClick={event => event.stopPropagation()}>
    <Button type="button" variant="ghost" size="sm" aria-label={`Удалить рейс ${trip.id.slice(0, 8)}`}
      onClick={() => { setError(""); setOpen(true); }}><Trash2 className="size-4" />Удалить</Button>
    <ConfirmDeleteDialog entityLabel={`рейс ${trip.id.slice(0, 8)}`} open={open}
      onOpenChange={value => { if (!busy.current) setOpen(value); }} onConfirm={confirm}
      warning="Рейс будет скрыт, его действующие расходы исключатся из расчётов. История и ТТН сохранятся.">
      <div className="min-w-0 space-y-2 break-words text-sm">
        <p>{formatDate(trip.date + "T00:00:00Z")} · {trip.id}</p>
        <p>Проекты: {trip.shares.map(share => share.projectNumber).join(", ")}</p>
        {current ? <>
          <p>Отмена расхода: <strong>{formatExactMoney(current.amount, current.currency)}</strong> · {current.cashAccountName}</p>
          {current.allocations.map(allocation => <p key={allocation.id}>Проект {allocation.projectNumber}: −{formatExactMoney(allocation.bynAmount, "BYN")} расходов</p>)}
        </> : <p>Расход по рейсу не проведён. Денежные итоги не изменятся.</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
    </ConfirmDeleteDialog>
  </div>;
}
