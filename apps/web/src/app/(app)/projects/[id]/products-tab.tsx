"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { ProductStatus, Role } from "@prisma/client";

import { DragHandle } from "@/components/drag-handle";
import { ProductKanbanCard } from "@/components/product-kanban-card";
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
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  PRODUCT_STATUSES,
  productStatusLabels,
  productStatusStyles,
} from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import type { SketchFilePreview } from "@/lib/product-hero";
import { productStatusTargets, shouldRollbackProductStatus } from "@/lib/product-percentage-ui";
import { changeProductStatus, createProduct } from "@/server/products/actions";

export interface ProductCard {
  id: string;
  number: string;
  title: string;
  status: ProductStatus;
  statusChangedAt: string;
  expectedPrice: string | null;
    quantity: number;
  engineerName: string | null;
  engineerId: string | null;
  isEngineeringParticipant: boolean;
  hasB3d: boolean;
  noModel: boolean;
  sketchFile: SketchFilePreview | null;
}

function DraggableProduct({
  product,
  currency,
  showAmount,
  canDrag,
  onOpen,
}: {
  product: ProductCard;
  currency: string;
  showAmount: boolean;
  canDrag: boolean;
  onOpen: (product: ProductCard) => void;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } =
    useDraggable({ id: product.id, disabled: !canDrag });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("relative", isDragging && "opacity-40")}
      onClick={() => onOpen(product)}
    >
      {canDrag && <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={product.title} />}
      <ProductKanbanCard
        product={product}
        currency={currency}
        showAmount={showAmount}
      />
    </div>
  );
}

function StatusColumn({
  status,
  products,
  currency,
  showAmount,
  canDrop,
  canDrag,
  onOpen,
}: {
  status: (typeof PRODUCT_STATUSES)[number];
  products: ProductCard[];
  currency: string;
  showAmount: boolean;
  canDrop: boolean;
  canDrag: (product: ProductCard) => boolean;
  onOpen: (product: ProductCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id, disabled: !canDrop });
  const style = productStatusStyles[status.id];
  return (
    <div
      ref={setNodeRef}
      data-slot="kanban-column"
      className={cn(
        "flex w-60 shrink-0 flex-col gap-2 rounded-xl border p-2 transition-colors",
        style.column,
        status.service && "border-2",
        isOver && "border-primary/60 bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <span className={cn("text-sm font-medium", style.header)}>
          {status.label}
        </span>
        <Badge variant="secondary">{products.length}</Badge>
      </div>
      <div className="flex min-h-20 flex-col gap-2">
        {products.map((product) => (
          <DraggableProduct
            key={product.id}
            product={product}
            currency={currency}
            showAmount={showAmount}
            canDrag={canDrag(product)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

// Вкладка «Изделия» проекта: мини-канбан по статусам изделий (§6) с
// перетаскиванием (оптимистично, с откатом) + добавление изделия.
// Клик по карточке — карточка изделия (/products/<id>).
export function ProductsTab({
  projectId,
  currency,
  initialProducts,
  canManage,
  actorRoles,
  showAmount,
  engineerOptions,
}: {
  projectId: string;
  currency: string;
  initialProducts: ProductCard[];
  canManage: boolean;
  actorRoles: readonly Role[];
  showAmount: boolean;
  engineerOptions: { value: string; label: string; hint?: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [products, setProducts] = useState(initialProducts);

  // Синхронизация с сервером после router.refresh() (создание изделия
  // и revalidatePath из server actions) — иначе канбан не видит новые данные.
  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [initialPrice, setInitialPrice] = useState("");
  const [description, setDescription] = useState("");
  const [engineerId, setEngineerId] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function applyStatus(productId: string, toStatus: ProductStatus) {
    setProducts((prev) =>
      prev.map((product) =>
        product.id === productId
          ? {
              ...product,
              status: toStatus,
              statusChangedAt: new Date().toISOString(),
            }
          : product,
      ),
    );
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const product = products.find((item) => item.id === String(active.id));
    const toStatus = over.id as ProductStatus;
    if (!product || product.status === toStatus) return;

    const allowedTargets = productStatusTargets(actorRoles, {
      from: product.status,
      assignedEngineer: product.isEngineeringParticipant,
      participant: product.isEngineeringParticipant,
      hasB3d: product.hasB3d,
      noModel: product.noModel,
    });
    if (!allowedTargets.includes(toStatus)) {
      toast.error("Нет права на такой переход статуса");
      return;
    }

    const fromStatus = product.status;
    applyStatus(product.id, toStatus);
    startTransition(async () => {
      const result = await changeProductStatus(product.id, toStatus);
      if (shouldRollbackProductStatus(result)) {
        applyStatus(product.id, fromStatus); // откат оптимистичного обновления
        toast.error(result.error ?? "Не удалось сменить статус");
      } else {
        toast.success(result.financeState === "PENDING_FX"
          ? `Статус сохранён: ${productStatusLabels[toStatus]}. Расчёт ожидает курса.`
          : `Статус: ${productStatusLabels[toStatus]}`);
        if (actorRoles.length === 1 && actorRoles[0] === "ENGINEER" && toStatus === "PRODUCTION")
          router.push("/products");
        else
          router.refresh();
      }
    });
  }

  const activeProduct = products.find((product) => product.id === activeId);
  const parsedPrice = price.trim() === "" ? undefined : Number(price);
  const parsedInitialPrice =
    initialPrice.trim() === "" ? undefined : Number(initialPrice);
  const parsedQuantity = Number(quantity);
  const canCreate =
    Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 2_147_483_647 &&
    title.trim().length > 0 &&
    (parsedPrice === undefined || (!Number.isNaN(parsedPrice) && parsedPrice >= 0)) &&
    (parsedInitialPrice === undefined ||
      (!Number.isNaN(parsedInitialPrice) && parsedInitialPrice >= 0));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Клик по изделию — карточка с задачами, материалами и файлами;
          доступный переход статуса меняется перетаскиванием.
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Изделие
          </Button>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">{products.length} {products.length % 100 >= 11 && products.length % 100 <= 14 ? "позиций" : products.length % 10 === 1 ? "позиция" : [2, 3, 4].includes(products.length % 10) ? "позиции" : "позиций"} · {products.reduce((sum, product) => sum + product.quantity, 0)} шт.</p>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div data-slot="kanban-scroll" className="flex min-w-0 gap-3 overflow-x-auto pb-4">
          {PRODUCT_STATUSES.map((status) => (
            <StatusColumn
              key={status.id}
              status={status}
              products={products.filter((product) => product.status === status.id)}
              currency={currency}
              showAmount={showAmount}
              canDrag={(product) => canManage || productStatusTargets(actorRoles, {
                from: product.status,
                assignedEngineer: product.isEngineeringParticipant,
                participant: product.isEngineeringParticipant,
                hasB3d: product.hasB3d,
                noModel: product.noModel,
              }).length > 0}
              canDrop={canManage || (!!activeProduct && productStatusTargets(actorRoles, {
                from: activeProduct.status,
                assignedEngineer: activeProduct.isEngineeringParticipant,
                participant: activeProduct.isEngineeringParticipant,
                hasB3d: activeProduct.hasB3d,
                noModel: activeProduct.noModel,
              }).includes(status.id))}
              onOpen={(product) => router.push(`/products/${product.number}`)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeProduct ? (
            <ProductKanbanCard
              product={activeProduct}
              currency={currency}
              showAmount={showAmount}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) {
            setTitle("");
            setKind("");
            setPrice("");
                    setQuantity("1");
            setInitialPrice("");
            setDescription("");
            setEngineerId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новое изделие</DialogTitle>
            <DialogDescription>
              Изделие появится в колонке «Проектирование»; номер присвоится
              автоматически.
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
            {showAmount ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="product-initial-price">
                  Первоначальная цена за 1 шт. (КП), {currency}
                </Label>
                <Input
                  id="product-initial-price"
                  type="number"
                  min="0"
                  value={initialPrice}
                  onChange={(event) => setInitialPrice(event.target.value)}
                  placeholder="не обязательна"
                />
              </div>
            ) : null}
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!canCreate || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await createProduct({
                    projectId,
                    title: title.trim(),
                    kind: kind.trim() || undefined,
                    expectedPrice: parsedPrice,
                    quantity: parsedQuantity,
                    initialPrice: parsedInitialPrice,
                    description: description.trim() || undefined,
                    engineerId: engineerId || undefined,
                  });
                  if (result.ok) {
                    toast.success("Изделие создано");
                    setCreateOpen(false);
                    setTitle("");
                    setKind("");
                    setPrice("");
                    setQuantity("1");
                    setDescription("");
                    router.refresh();
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pending ? "Создание…" : "Создать изделие"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
