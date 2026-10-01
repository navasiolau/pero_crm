"use client";

import { useEffect, useState } from "react";
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
import type { ProductStatus } from "@prisma/client";

import { DragHandle } from "@/components/drag-handle";
import { ProductKanbanCard } from "@/components/product-kanban-card";
import { Badge } from "@/components/ui/badge";
import {
  PRODUCT_STATUSES,
  productStatusLabels,
  productStatusStyles,
} from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import { changeProductStatus } from "@/server/products/actions";

import type { ProductRow } from "./products-view";

function DraggableProduct({
  product,
  showAmount,
  canManage,
  onOpen,
}: {
  product: ProductRow;
  showAmount: boolean;
  canManage: boolean;
  onOpen: (product: ProductRow) => void;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } =
    useDraggable({ id: product.id, disabled: !canManage });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("relative", isDragging && "opacity-40")}
      onClick={() => onOpen(product)}
    >
      {canManage && <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={product.title} />}
      <ProductKanbanCard
        product={product}
        currency={product.currency}
        showAmount={showAmount}
        projectContext={`Проект ${product.projectNumber} · ${product.clientName}`}
      />
    </div>
  );
}

function StatusColumn({
  status,
  products,
  showAmount,
  canManage,
  onOpen,
}: {
  status: (typeof PRODUCT_STATUSES)[number];
  products: ProductRow[];
  showAmount: boolean;
  canManage: boolean;
  onOpen: (product: ProductRow) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
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
          {status.label}
        </span>
        <Badge variant="secondary">{products.length}</Badge>
      </div>
      <div className="flex min-h-24 flex-col gap-2">
        {products.map((product) => (
          <DraggableProduct
            key={product.id}
            product={product}
            showAmount={showAmount}
            canManage={canManage}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

// Канбан изделий: колонки = статусы §6, свободные переходы, оптимичное
// обновление с откатом (dnd — админ/директор/менеджер). Порядок и фильтры —
// с сервера (новые сверху); после смены статуса revalidate синхронизирует
// доску — перетащенное в «Готово» при активной галочке уходит с доски.
export function ProductsKanban({
  initialProducts,
  canManage,
  showAmount,
}: {
  initialProducts: ProductRow[];
  canManage: boolean;
  showAmount: boolean;
}) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);

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

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const product = products.find((item) => item.id === String(active.id));
    const toStatus = over.id as ProductStatus;
    if (!product || product.status === toStatus) return;

    const fromStatus = product.status;
    applyStatus(product.id, toStatus);
    const result = await changeProductStatus(product.id, toStatus);
    if (!result.ok) {
      applyStatus(product.id, fromStatus); // откат оптимистичного обновления
      toast.error(result.error ?? "Не удалось сменить статус");
      return;
    }
    toast.success(`Статус: ${productStatusLabels[toStatus]}`);
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
      <div data-slot="kanban-scroll" className="flex min-w-0 gap-3 overflow-x-auto pb-4">
        {PRODUCT_STATUSES.map((status) => (
          <StatusColumn
            key={status.id}
            status={status}
            products={products.filter((product) => product.status === status.id)}
            showAmount={showAmount}
            canManage={canManage}
            onOpen={(product) => router.push(`/products/${product.number}`)}
          />
        ))}
      </div>
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
