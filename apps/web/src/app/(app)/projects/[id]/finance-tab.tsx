"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  type DataColumn,
} from "@/components/ui/data-table";
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
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { formatAmount } from "@/lib/format";
import { addPayment, deletePayment } from "@/server/payments/actions";

export type PaymentRow = {
  id: string;
  amount: number;
  paidAt: string;
  comment: string | null;
  createdByName: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU");
}

// Вкладка «Финансы» проекта (§11, только админ/директор): приходы —
// они же оборот для «% от оборота» (§10). Кассы, курсы и маржа — фаза 5.
export function FinanceTab({
  projectId,
  currency,
  expectedPrice,
  payments,
}: {
  projectId: string;
  currency: string;
  expectedPrice: number | null;
  payments: PaymentRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [comment, setComment] = useState("");
  const [deleting, setDeleting] = useState<PaymentRow | null>(null);

  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const parsed = amount.trim() === "" ? NaN : Number(amount);

  const columns: DataColumn<PaymentRow>[] = [
    {
      id: "date",
      header: "Дата",
      sortable: true,
      sortValue: (row) => row.paidAt,
      cell: (row) => formatDate(row.paidAt),
    },
    {
      id: "comment",
      header: "Комментарий",
      sortable: true,
      sortValue: (row) => row.comment ?? "",
      cell: (row) => row.comment ?? "—",
    },
    {
      id: "createdBy",
      header: "Кто внёс",
      sortable: true,
      sortValue: (row) => row.createdByName ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.createdByName ?? "—"}</span>
      ),
    },
    {
      id: "amount",
      header: "Сумма",
      sortable: true,
      sortValue: (row) => row.amount,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => formatAmount(row.amount, currency),
    },
    {
      id: "actions",
      header: "",
      className: "w-10",
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Удалить приход"
          onClick={(event) => {
            event.stopPropagation();
            setDeleting(row);
          }}
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Оплачено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatAmount(total, currency)}
            </div>
            {expectedPrice !== null ? (
              <p className="text-xs text-muted-foreground">
                из {formatAmount(expectedPrice, currency)} ожидаемой цены
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Осталось оплатить
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {expectedPrice !== null
                ? formatAmount(Math.max(0, expectedPrice - total), currency)
                : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Приходы</h3>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Добавить приход
          </Button>
        </div>
        <DataTable
          columns={columns}
          rows={payments}
          searchPlaceholder="Поиск по комментарию…"
          emptyText="Приходов по проекту пока нет"
        />
        <p className="text-xs text-muted-foreground">
          Экономика проекта (расходы, маржа с индикатором, курсы валют)
          появится в фазе 5.
        </p>
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (!next) {
            setAmount("");
            setPaidAt("");
            setComment("");
          }
          setAddOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Приход по проекту</DialogTitle>
            <DialogDescription>
              Платёж попадёт в оборот месяца для «% от оборота»
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-amount">Сумма, {currency} *</Label>
              <Input
                id="pay-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-date">Дата</Label>
              <Input
                id="pay-date"
                type="date"
                value={paidAt}
                onChange={(event) => setPaidAt(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Пусто — сегодня
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-comment">Комментарий</Label>
              <Input
                id="pay-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Аванс, окончательный расчёт…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={pending || !Number.isFinite(parsed) || parsed <= 0}
              onClick={() =>
                startTransition(async () => {
                  const result = await addPayment({
                    projectId,
                    amount: parsed,
                    paidAt: paidAt || undefined,
                    comment: comment.trim() || undefined,
                  });
                  if (result.ok) {
                    toast.success("Приход внесён");
                    setAddOpen(false);
                    setAmount("");
                    setPaidAt("");
                    setComment("");
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : "Внести приход"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        entityLabel="приход"
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        warning={
          deleting
            ? `${formatAmount(deleting.amount, currency)} — оборот месяца уменьшится.`
            : undefined
        }
        onConfirm={async () => {
          if (!deleting) return false;
          const result = await deletePayment(deleting.id);
          if (result.ok) {
            toast.success("Приход удалён");
            return true;
          }
          toast.error(result.error ?? "Ошибка удаления");
          return false;
        }}
      />
    </div>
  );
}
