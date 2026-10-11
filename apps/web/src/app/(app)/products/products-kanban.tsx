"use client";

import { KanbanScrollArea } from "@/components/kanban-scroll-area";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import type { ProductStatus, Role } from "@prisma/client";

import { useListParams } from "@/lib/list-params";
import { globalProductsHref, productDetailHref } from "@/lib/product-return-navigation";
import { DragHandle } from "@/components/drag-handle";
import { ProductKanbanCard } from "@/components/product-kanban-card";
import { Badge } from "@/components/ui/badge";
import {
  PRODUCT_STATUSES,
  visibleProductStatuses,
  productStatusLabels,
  productStatusStyles,
} from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import { currentProductStatusTargets, shouldRollbackProductStatus } from "@/lib/product-percentage-ui";
import { changeProductStatus } from "@/server/products/actions";

import type { ProductRow } from "./products-view";

const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };

const DraggableProduct = memo(function DraggableProduct({
  product,
  showAmount,
  canDrag,
  onOpen,
}: {
  product: ProductRow;
  showAmount: boolean;
  canDrag: boolean;
  onOpen: (product: ProductRow) => void;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } =
    useDraggable({ id: product.id, disabled: !canDrag });

  return (
    <div
      ref={setNodeRef}
      data-kanban-card-id={product.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("relative", isDragging && "opacity-40")}
      onClick={() => onOpen(product)}
    >
      {canDrag && <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={product.title} />}
      <ProductKanbanCard
        product={product}
        currency={product.currency}
        showAmount={showAmount}
        projectContext={`Проект ${product.projectNumber} · ${product.clientName}`}
        dragging={isDragging}
        coverAction={{type:"navigate",onOpen:()=>onOpen(product)}}
      />
    </div>
  );
});

const StatusColumn = memo(function StatusColumn({
  status,
  products,
  showAmount,
  canDrop,
  canDrag,
  onOpen,
}: {
  status: (typeof PRODUCT_STATUSES)[number];
  products: ProductRow[];
  showAmount: boolean;
  canDrop: boolean;
  canDrag: (product: ProductRow) => boolean;
  onOpen: (product: ProductRow) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id, disabled: !canDrop });
  const style = productStatusStyles[status.id];
  return (
    <div
      ref={setNodeRef}
      data-slot="kanban-column"
      className={cn(
        "flex w-64 shrink-0 flex-col gap-2 rounded-xl border p-2 transition-colors",
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
      <div className="flex min-h-24 flex-col gap-2">
        {products.map((product) => (
          <DraggableProduct
            key={product.id}
            product={product}
            showAmount={showAmount}
            canDrag={canDrag(product)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
});

// Канбан изделий: колонки = статусы §6, доступность перехода определяется
// ролью и данными изделия. Порядок и фильтры —
// с сервера (новые сверху); после смены статуса revalidate синхронизирует
// доску — перетащенное в «Готово» при активной галочке уходит с доски.
export function ProductsKanban({
  initialProducts,
  searchText = "",
  searchReady = false,
  actorRoles,
  actorUserId,
  showAmount,
}: {
  initialProducts: ProductRow[];
  // Без подтверждённой пары query/rows обычный caller не запускает поиск.
  searchText?: string;
  searchReady?: boolean;
  canManage: boolean;
  actorRoles: readonly Role[];
  actorUserId?: string;
  showAmount: boolean;
}) {
  const router = useRouter();
  const { getQuery } = useListParams();
  const visibleStatuses = useMemo(() => visibleProductStatuses(actorRoles), [actorRoles]);
  const [products, setProducts] = useState(() => initialProducts.filter(product => visibleStatuses.some(status => status.id === product.status)));
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setProducts(initialProducts.filter(product => visibleStatuses.some(status => status.id === product.status)));
  }, [initialProducts, visibleStatuses]);

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
  );

  const columns = useMemo(() => visibleStatuses.map(status => ({
    status, products: products.filter(product => product.status === status.id),
  })), [products, visibleStatuses]);
  const canDrag = useCallback((product: ProductRow) => currentProductStatusTargets(actorRoles, product, actorUserId).some(target => target !== product.status), [actorRoles, actorUserId]);
  const onOpen = useCallback((product: ProductRow) => router.push(
    productDetailHref(product.number, globalProductsHref(getQuery())),
  ), [router, getQuery]);

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

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const product = products.find((item) => item.id === String(active.id));
    const toStatus = over.id as ProductStatus;
    if (!product || product.status === toStatus) return;
    const allowedTargets = currentProductStatusTargets(actorRoles, product, actorUserId);
    if (!allowedTargets.includes(toStatus)) {
      toast.error("Нет права на такой переход статуса");
      return;
    }

    const fromStatus = product.status;
    applyStatus(product.id, toStatus);
    const result = await changeProductStatus(product.id, toStatus);
    if (shouldRollbackProductStatus(result)) {
      applyStatus(product.id, fromStatus); // откат оптимистичного обновления
      toast.error(result.error ?? "Не удалось сменить статус");
      return;
    }
    toast.success(result.financeState === "PENDING_FX"
      ? `Статус сохранён: ${productStatusLabels[toStatus]}. Расчёт ожидает курса.`
      : `Статус: ${productStatusLabels[toStatus]}`);
    if (actorRoles.length === 1 && actorRoles[0] === "ENGINEER" && toStatus === "PRODUCTION")
      router.push("/products");
    else
      router.refresh();
  }

  const activeProduct = products.find((product) => product.id === activeId);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={(event) => {
        void onDragEnd(event);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <KanbanScrollArea label="Канбан изделий" searchFocus={{
          query: searchText,
          cardId: products.find(item => item.number === searchText.trim())?.id ?? null,
          ready: searchReady && products === initialProducts && !activeId,
        }}>
        {columns.map(({ status, products }) => (
          <StatusColumn
            key={status.id}
            status={status}
            products={products}
            showAmount={showAmount}
            canDrag={canDrag}
            canDrop={!!activeProduct && currentProductStatusTargets(actorRoles, activeProduct, actorUserId).includes(status.id)}
            onOpen={onOpen}
          />
        ))}
      </KanbanScrollArea>
      <DragOverlay>
        {activeProduct ? (
          <ProductKanbanCard
            product={activeProduct}
            currency={activeProduct.currency}
            showAmount={showAmount}
            projectContext={`Проект ${activeProduct.projectNumber} · ${activeProduct.clientName}`}
            dragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
