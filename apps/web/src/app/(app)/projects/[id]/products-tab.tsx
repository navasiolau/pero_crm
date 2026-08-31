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
import type { ProductStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/lib/format";
import {
  PRODUCT_STATUSES,
  daysOnStatus,
  productStatusLabels,
  productStatusStyles,
} from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import { changeProductStatus, createProduct } from "@/server/products/actions";

export interface ProductCard {
  id: string;
  number: string;
  title: string;
  status: ProductStatus;
  statusChangedAt: string;
  expectedPrice: string | null;
}

function ProductCardView({
  product,
  currency,
  showAmount,
  dragging,
}: {
  product: ProductCard;
  currency: string;
  showAmount: boolean;
  dragging?: boolean;
}) {
  const days = daysOnStatus(product.statusChangedAt);
  return (
    <Card
      className={cn(
        "cursor-grab touch-none select-none",
        dragging && "rotate-2 shadow-lg",
      )}
    >
      <CardContent className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{product.number}</span>
          <Badge variant="secondary" className="text-xs">
            {days} дн.
          </Badge>
        </div>
        <div className="text-sm">{product.title}</div>
        {showAmount ? (
          <div className="text-xs text-muted-foreground">
            {formatAmount(product.expectedPrice, currency)}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DraggableProduct({
  product,
  currency,
  showAmount,
  canManage,
  onOpen,
}: {
  product: ProductCard;
  currency: string;
  showAmount: boolean;
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: product.id, disabled: !canManage });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(isDragging && "opacity-40")}
      {...(canManage ? { ...listeners, ...attributes } : {})}
      onClick={() => onOpen(product.id)}
    >
      <ProductCardView
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
  canManage,
  onOpen,
}: {
  status: (typeof PRODUCT_STATUSES)[number];
  products: ProductCard[];
  currency: string;
  showAmount: boolean;
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const style = productStatusStyles[status.id];
  return (
    <div
      ref={setNodeRef}
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
            canManage={canManage}
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
  showAmount,
}: {
  projectId: string;
  currency: string;
  initialProducts: ProductCard[];
  canManage: boolean;
  showAmount: boolean;
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
  const [price, setPrice] = useState("");
  const [initialPrice, setInitialPrice] = useState("");
  const [description, setDescription] = useState("");

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

    const fromStatus = product.status;
    applyStatus(product.id, toStatus);
    startTransition(async () => {
      const result = await changeProductStatus(product.id, toStatus);
      if (!result.ok) {
        applyStatus(product.id, fromStatus); // откат оптимистичного обновления
        toast.error(result.error ?? "Не удалось сменить статус");
      } else {
        toast.success(`Статус: ${productStatusLabels[toStatus]}`);
      }
    });
  }

  const activeProduct = products.find((product) => product.id === activeId);
  const parsedPrice = price.trim() === "" ? undefined : Number(price);
  const parsedInitialPrice =
    initialPrice.trim() === "" ? undefined : Number(initialPrice);
  const canCreate =
    title.trim().length > 0 &&
    (parsedPrice === undefined || (!Number.isNaN(parsedPrice) && parsedPrice >= 0)) &&
    (parsedInitialPrice === undefined ||
      (!Number.isNaN(parsedInitialPrice) && parsedInitialPrice >= 0));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Клик по изделию — карточка с задачами, материалами и файлами;
          статус меняется перетаскиванием.
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Изделие
          </Button>
        ) : null}
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {PRODUCT_STATUSES.map((status) => (
            <StatusColumn
              key={status.id}
              status={status}
              products={products.filter((product) => product.status === status.id)}
              currency={currency}
              showAmount={showAmount}
              canManage={canManage}
              onOpen={(id) => router.push(`/products/${id}`)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeProduct ? (
            <ProductCardView
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
            setInitialPrice("");
            setDescription("");
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-price">Цена, {currency}</Label>
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
                  Первоначальная цена, {currency}
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
                    initialPrice: parsedInitialPrice,
                    description: description.trim() || undefined,
                  });
                  if (result.ok) {
                    toast.success("Изделие создано");
                    setCreateOpen(false);
                    setTitle("");
                    setKind("");
                    setPrice("");
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
