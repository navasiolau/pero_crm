"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProductStatus, Role } from "@prisma/client";

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
import { ProductQuantityInput } from "@/components/product-quantity-input";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import {
  PRODUCT_STATUSES,
  productStatusLabels,
  productStatusStyles,
} from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import { productStatusTargets, shouldRollbackProductStatus } from "@/lib/product-percentage-ui";
import {
  changeProductStatus,
  deleteProduct,
  updateProduct,
} from "@/server/products/actions";

// Шапка карточки изделия: менеджмент управляет статусами свободно, инженер
// переводит своё DESIGN-изделие только в производство; цена остаётся менеджерской,
// инженер редактирует только тех. блок,
// удаление через ConfirmDeleteDialog.
export function ProductHeader({
  product,
  engineerOptions,
  currency,
  canManage,
  canEditTech,
  showAmount,
  actorRoles,
  hasB3d,
  noModel,
  isEngineeringParticipant,
}: {
  product: {
    id: string;
    number: string;
    title: string;
    kind: string | null;
    status: ProductStatus;
    expectedPrice: string | null;
    quantity: number;
    initialPrice: string | null;
    description: string | null;
    projectId: string;
    engineerId: string | null;
  };
  engineerOptions: { value: string; label: string; hint?: string }[];
  currency: string;
  canManage: boolean;
  canEditTech: boolean;
  showAmount: boolean;
  actorRoles: readonly Role[];
  hasB3d: boolean;
  noModel: boolean;
  isEngineeringParticipant: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState(product.title);
  const [kind, setKind] = useState(product.kind ?? "");
  const [quantity, setQuantity] = useState(String(product.quantity));
  const [price, setPrice] = useState(product.expectedPrice ?? "");
  const [initialPrice, setInitialPrice] = useState(product.initialPrice ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  // Инженер изделия — ответственен за конкретное изделие (§10)
  const [engineerId, setEngineerId] = useState(product.engineerId ?? "");

  const onlyTech = canEditTech && !canManage; // инженер — только тех. блок
  const parsedPrice = price.trim() === "" ? null : Number(price);
  const parsedInitialPrice =
    initialPrice.trim() === "" ? null : Number(initialPrice);
  const parsedQuantity = Number(quantity);
  const canSave =
    Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 2_147_483_647 &&
    (onlyTech || title.trim().length > 0) &&
    (parsedPrice === null || (!Number.isNaN(parsedPrice) && parsedPrice >= 0)) &&
    (parsedInitialPrice === null ||
      (!Number.isNaN(parsedInitialPrice) && parsedInitialPrice >= 0));
  const allowedStatusTargets = productStatusTargets(actorRoles, {
    from: product.status,
    assignedEngineer: isEngineeringParticipant,
    participant: isEngineeringParticipant,
    hasB3d,
    noModel,
  });
  const canEngineerStart = !canManage && actorRoles.includes("ENGINEER") &&
    isEngineeringParticipant && product.status === "DESIGN";

  async function moveStatus(toStatus: ProductStatus) {
    const result = await changeProductStatus(product.id, toStatus);
    if (shouldRollbackProductStatus(result)) {
      toast.error(result.error ?? "Не удалось сменить статус");
      return;
    }
    toast.success(result.financeState === "PENDING_FX"
      ? `Статус сохранён: ${productStatusLabels[toStatus]}. Расчёт ожидает курса.`
      : `Статус: ${productStatusLabels[toStatus]}`);
    if (actorRoles.length === 1 && actorRoles[0] === "ENGINEER" && toStatus === "PRODUCTION")
      router.replace("/products");
    else
      router.refresh();
  }

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
              await moveStatus(toStatus);
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
      {canEngineerStart ? (
        <div className="flex min-w-0 flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            className="min-h-12"
            disabled={pending || !allowedStatusTargets.includes("PRODUCTION")}
            onClick={() => startTransition(() => { void moveStatus("PRODUCTION"); })}
          >
            Передать в производство
          </Button>
          {!allowedStatusTargets.includes("PRODUCTION") ? (
            <span role="note" className="max-w-64 text-xs text-muted-foreground">
              Для передачи нужна B3D-модель этого изделия или отметка менеджера «Модели нет».
            </span>
          ) : null}
        </div>
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
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ph-kind">Вид изделия</Label>
                  <Input
                    id="ph-kind"
                    value={kind}
                    onChange={(event) => setKind(event.target.value)}
                    placeholder="Кухня, шкаф, перегородка…"
                  />
                </div>
                <ProductQuantityInput value={quantity} onChange={setQuantity} price={price.trim() || null} currency={currency} showAmount={showAmount} />
                {showAmount ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ph-price">Цена за 1 шт., {currency}</Label>
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
                {showAmount ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ph-initial-price">
                      Первоначальная цена за 1 шт. (КП), {currency}
                    </Label>
                    <Input
                      id="ph-initial-price"
                      type="number"
                      min="0"
                      value={initialPrice}
                      onChange={(event) => setInitialPrice(event.target.value)}
                      placeholder="не обязательна"
                    />
                  </div>
                ) : null}
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
              </>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ph-description">Техническое описание</Label>
              <Textarea
                id="ph-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Материалы, размеры, особенности…"
                className="min-h-24 field-sizing-content"
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
                          kind: kind.trim() || null,
                          expectedPrice: parsedPrice,
                    quantity: parsedQuantity,
                          initialPrice: parsedInitialPrice,
                          description: description.trim() || null,
                          engineerId: engineerId || null,
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
