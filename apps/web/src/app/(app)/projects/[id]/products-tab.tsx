"use client";

import { KanbanScrollArea } from "@/components/kanban-scroll-area";

import { useEffect, useState, useTransition } from "react";
import { productDetailHref, projectProductsHref } from "@/lib/product-return-navigation";
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
import type { ProductStatus, ProjectStage, Role } from "@prisma/client";

import { DragHandle } from "@/components/drag-handle";
import { ProductKanbanCard } from "@/components/product-kanban-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PRODUCT_STATUSES,
  visibleProductStatuses,
  productStatusLabels,
  productStatusStyles,
} from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import type { SketchFilePreview } from "@/lib/product-hero";
import { currentProductStatusTargets, shouldRollbackProductStatus } from "@/lib/product-percentage-ui";
import { changeProductStatus } from "@/server/products/actions";
import { CreateProductDialog } from "./create-product-dialog";

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
        coverAction={{type:"navigate",onOpen:()=>onOpen(product)}}
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
          {status.columnLabel ?? status.label}
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
  projectStage,
  currency,
  initialProducts,
  canManage,
  actorRoles,
  actorUserId,
  showAmount,
  engineerOptions,
}: {
  projectId: string;
  projectStage?: ProjectStage;
  currency: string;
  initialProducts: ProductCard[];
  canManage: boolean;
  actorRoles: readonly Role[];
  actorUserId: string;
  showAmount: boolean;
  engineerOptions: { value: string; label: string; hint?: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const visibleStatuses = visibleProductStatuses(actorRoles);
  const visibleRows = initialProducts.filter(product => visibleStatuses.some(status => status.id === product.status));
  const [products, setProducts] = useState(visibleRows);

  // Синхронизация с сервером после router.refresh() (создание изделия
  // и revalidatePath из server actions) — иначе канбан не видит новые данные.
  useEffect(() => {
    setProducts(initialProducts.filter(product => visibleProductStatuses(actorRoles).some(status => status.id === product.status)));
  }, [initialProducts, actorRoles]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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

    const allowedTargets = currentProductStatusTargets(actorRoles, { ...product, projectStage }, actorUserId);
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
        router.refresh();
      }
    });
  }

  const activeProduct = products.find((product) => product.id === activeId);

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
        <KanbanScrollArea label="Изделия проекта">
          {visibleStatuses.map((status) => (
            <StatusColumn
              key={status.id}
              status={status}
              products={products.filter((product) => product.status === status.id)}
              currency={currency}
              showAmount={showAmount}
              canDrag={(product) => currentProductStatusTargets(actorRoles, { ...product, projectStage }, actorUserId).some(target => target !== product.status)}
              canDrop={!!activeProduct && currentProductStatusTargets(actorRoles, { ...activeProduct, projectStage }, actorUserId).includes(status.id)}
              onOpen={(product) => router.push(productDetailHref(product.number, projectProductsHref(projectId)))}
            />
          ))}
        </KanbanScrollArea>
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

      <CreateProductDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => router.refresh()}
        projectId={projectId}
        currency={currency}
        showAmount={showAmount}
        engineerOptions={engineerOptions}
        statusPending={pending}
      />
    </div>
  );
}
