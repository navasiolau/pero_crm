"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProductStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import {
  PRODUCT_STATUSES,
  productStatusLabels,
  productStatusStyles,
} from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import {
  changeProductStatus,
  deleteProduct,
  updateProduct,
} from "@/server/products/actions";

// Шапка карточки изделия: статус с быстрой сменой (админ/директор/менеджер),
// редактирование (полностью — они же; инженер — только тех. блок),
// удаление через ConfirmDeleteDialog.
export function ProductHeader({
  product,
  currency,
  canManage,
  canEditTech,
  showAmount,
}: {
  product: {
    id: string;
    number: string;
    title: string;
    status: ProductStatus;
    expectedPrice: string | null;
    description: string | null;
    projectId: string;
  };
  currency: string;
  canManage: boolean;
  canEditTech: boolean;
  showAmount: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState(product.title);
  const [price, setPrice] = useState(product.expectedPrice ?? "");
  const [description, setDescription] = useState(product.description ?? "");

  const onlyTech = canEditTech && !canManage; // инженер — только тех. блок
  const parsedPrice = price.trim() === "" ? null : Number(price);
  const canSave =
    (onlyTech || title.trim().length > 0) &&
    (parsedPrice === null || (!Number.isNaN(parsedPrice) && parsedPrice >= 0));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant="outline"
        className={cn("border-transparent", productStatusStyles[product.status].badge)}
      >
        {productStatusLabels[product.status]}
      </Badge>
      {canManage ? (
        <Select
          value={product.status}
          onValueChange={(value) => {
            const toStatus = value as ProductStatus | undefined;
            if (!toStatus || toStatus === product.status) return;
            startTransition(async () => {
              const result = await changeProductStatus(product.id, toStatus);
              if (result.ok) {
                toast.success(`Статус: ${productStatusLabels[toStatus]}`);
                router.refresh();
              } else {
                toast.error(result.error ?? "Не удалось сменить статус");
              }
            });
          }}
          disabled={pending}
        >
          <SelectTrigger className="w-48" aria-label="Сменить статус">
            <SelectValue>{productStatusLabels[product.status]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PRODUCT_STATUSES.map((status) => (
              <SelectItem key={status.id} value={status.id}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {canEditTech ? (
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" /> Редактировать
        </Button>
      ) : null}
      {canManage ? (
        <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="size-4" /> Удалить
        </Button>
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактирование изделия</DialogTitle>
            <DialogDescription>
              {onlyTech
                ? "Инженер правит только технический блок."
                : `Цена — в валюте проекта (${currency}).`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {!onlyTech ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ph-title">Название *</Label>
                  <Input
                    id="ph-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                {showAmount ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ph-price">Цена, {currency}</Label>
                    <Input
                      id="ph-price"
                      type="number"
                      min="0"
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                      placeholder="не задана"
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ph-description">Технический блок</Label>
              <Textarea
                id="ph-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Материалы, размеры, особенности…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!canSave || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await updateProduct(
                    product.id,
                    onlyTech
                      ? { description: description.trim() || null }
                      : {
                          title: title.trim(),
                          expectedPrice: parsedPrice,
                          description: description.trim() || null,
                        },
                  );
                  if (result.ok) {
                    toast.success("Сохранено");
                    setEditOpen(false);
                    router.refresh();
                  } else {
                    toast.error(result.error ?? "Ошибка сохранения");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        entityLabel={`изделие «${product.number} · ${product.title}»`}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        warning="Нельзя удалить, пока к изделию привязаны задачи, работы или материалы. Файлы останутся в проекте."
        onConfirm={async () => {
          const result = await deleteProduct(product.id);
          if (result.ok) {
            toast.success("Изделие удалено");
            router.push(`/projects/${product.projectId}`);
            return true;
          }
          toast.error(result.error ?? "Ошибка удаления");
          return false;
        }}
      />
    </div>
  );
}
