"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductQuantityInput } from "@/components/product-quantity-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createProduct } from "@/server/products/actions";

export function CreateProductDialog({
  open,
  onOpenChange,
  onCreated,
  projectId,
  currency,
  showAmount,
  engineerOptions,
  statusPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  projectId: string;
  currency: string;
  showAmount: boolean;
  engineerOptions: { value: string; label: string; hint?: string }[];
  statusPending: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const busy = pending || statusPending;
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [engineerId, setEngineerId] = useState("");

  const parsedPrice = price.trim() === "" ? undefined : Number(price);
  const parsedQuantity = Number(quantity);
  const canCreate =
    Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 2_147_483_647 &&
    title.trim().length > 0 &&
    (parsedPrice === undefined || (!Number.isNaN(parsedPrice) && parsedPrice >= 0));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setTitle("");
          setKind("");
          setPrice("");
          setQuantity("1");
          setDescription("");
          setEngineerId("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новое изделие</DialogTitle>
          <DialogDescription>
            Начальный статус изделия зависит от этапа проекта.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-title">Название *</Label>
            <Input
              id="product-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Кухня «Модерн», шкаф-купе…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-kind">Вид изделия</Label>
            <Input
              id="product-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              placeholder="Кухня, шкаф, перегородка…"
            />
          </div>
          <ProductQuantityInput value={quantity} onChange={setQuantity} price={price.trim() || null} currency={currency} showAmount={showAmount} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-price">Цена за 1 шт., {currency}</Label>
            <Input
              id="product-price"
              type="number"
              min="0"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="не обязательно"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-description">Технический блок</Label>
            <Textarea
              id="product-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Материалы, размеры, особенности…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Инженер</Label>
            <SearchableSelect
              options={engineerOptions}
              value={engineerId}
              onChange={(value) => setEngineerId(value ?? "")}
              placeholder="не назначен"
              searchPlaceholder="Поиск инженера…"
              allowClear
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!canCreate || busy}
            onClick={() =>
              startTransition(async () => {
                const result = await createProduct({
                  projectId,
                  title: title.trim(),
                  kind: kind.trim() || undefined,
                  expectedPrice: parsedPrice,
                  quantity: parsedQuantity,
                  description,
                  engineerId: engineerId || undefined,
                });
                if (result.ok) {
                  toast.success("Изделие создано");
                  onOpenChange(false);
                  setTitle("");
                  setKind("");
                  setPrice("");
                  setQuantity("1");
                  setDescription("");
                  onCreated();
                } else {
                  toast.error(result.error ?? "Ошибка");
                }
              })
            }
          >
            {busy ? "Создание…" : "Создать изделие"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
