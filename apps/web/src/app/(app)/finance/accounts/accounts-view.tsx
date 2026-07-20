"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Power } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addCashAccount, toggleCashAccount } from "@/server/finance/actions";
import type { CashAccountView } from "@/server/finance/queries";

const CURRENCIES = ["BYN", "RUB", "USD", "EUR"];

// Кассы организации (§11): каждая в своей валюте. Касса с историей
// операций не удаляется — деактивируется (исчезает из выбора).
export function AccountsView({ accounts }: { accounts: CashAccountView[] }) {
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("BYN");
  const [comment, setComment] = useState("");

  const columns: DataColumn<CashAccountView>[] = [
    {
      id: "name",
      header: "Название",
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => (
        <span className={cn(!row.active && "text-muted-foreground line-through")}>
          {row.name}
        </span>
      ),
    },
    {
      id: "currency",
      header: "Валюта",
      sortable: true,
      sortValue: (row) => row.currency,
      cell: (row) => row.currency,
    },
    {
      id: "balance",
      header: "Остаток",
      sortable: true,
      sortValue: (row) => row.balance,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => (
        <span className={cn(row.balance < 0 && "text-red-600")}>
          {formatAmount(row.balance, row.currency)}
        </span>
      ),
    },
    {
      id: "comment",
      header: "Комментарий",
      sortable: true,
      sortValue: (row) => row.comment ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.comment ?? "—"}</span>
      ),
    },
    {
      id: "status",
      header: "Статус",
      sortable: true,
      sortValue: (row) => (row.active ? 1 : 0),
      cell: (row) =>
        row.active ? (
          <Badge variant="outline">Активна</Badge>
        ) : (
          <Badge variant="secondary">Неактивна</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      className: "w-10",
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={row.active ? "Деактивировать кассу" : "Активировать кассу"}
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation();
            startTransition(async () => {
              const result = await toggleCashAccount(row.id);
              if (result.ok) {
                toast.success(
                  row.active ? "Касса деактивирована" : "Касса активирована",
                );
              } else {
                toast.error(result.error ?? "Ошибка");
              }
            });
          }}
        >
          <Power className="size-4 text-muted-foreground" />
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Кассы</h1>
          <p className="text-sm text-muted-foreground">
            Остаток — сумма приходов минус расходы по кассе, в её валюте
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          Добавить кассу
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={accounts}
        searchPlaceholder="Поиск по кассам…"
        emptyText="Касс пока нет — добавьте первую"
      />

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (!next) {
            setName("");
            setCurrency("BYN");
            setComment("");
          }
          setAddOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая касса</DialogTitle>
            <DialogDescription>
              Операции по кассе вносятся в её валюте
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cash-name">Название *</Label>
              <Input
                id="cash-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Основная касса, Валютный счёт…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Валюта *</Label>
              <Select value={currency} onValueChange={(next) => setCurrency(next ?? "BYN")}>
                <SelectTrigger>
                  <SelectValue>{currency}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cash-comment">Комментарий</Label>
              <Input
                id="cash-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Необязательно"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={pending || name.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await addCashAccount({
                    name: name.trim(),
                    currency,
                    comment: comment.trim() || undefined,
                  });
                  if (result.ok) {
                    toast.success("Касса создана");
                    setAddOpen(false);
                    setName("");
                    setCurrency("BYN");
                    setComment("");
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
