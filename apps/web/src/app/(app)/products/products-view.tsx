"use client";

import { useTransition } from "react";
import { LayoutGrid, Table2 } from "lucide-react";
import type { ProductStatus } from "@prisma/client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useListParams } from "@/lib/list-params";
import { saveViewPreference } from "@/server/preferences-actions";

import { ProductsFilterBar } from "./products-filter-bar";
import { ProductsKanban } from "./products-kanban";
import { ProductsTable } from "./products-table";

export interface ProductRow {
  id: string;
  number: string;
  title: string;
  kind: string | null;
  status: ProductStatus;
  statusChangedAt: string;
  expectedPrice: string | null;
  currency: string;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  clientId: string;
  clientName: string;
  engineerName: string | null;
}

// Раздел «Изделия»: канбан (по умолчанию) / таблица, фильтры в URL —
// те же принципы, что у проектов. Порядок — «новые сверху» (сервер).
export function ProductsView({
  view,
  products,
  total,
  page,
  pageSize,
  canManage,
  showAmount,
  projectOptions,
  clientOptions,
  engineerOptions,
}: {
  view: "kanban" | "table";
  // Канбан — все отфильтрованные изделия; таблица — одна страница
  products: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  canManage: boolean;
  showAmount: boolean;
  projectOptions: { value: string; label: string; hint?: string }[];
  clientOptions: { value: string; label: string; hint?: string }[];
  engineerOptions: { value: string; label: string; hint?: string }[];
}) {
  const { set } = useListParams();
  const [, startTransition] = useTransition();

  function switchView(next: "kanban" | "table") {
    set({ view: next });
    // Предпочтение — фолбэк для следующего визита (URL главнее)
    startTransition(async () => {
      await saveViewPreference("products.view", next);
    });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Изделия</h1>
          <p className="text-sm text-muted-foreground">
            Все изделия организации — клик по карточке/строке открывает карточку
            изделия; статус меняется перетаскиванием
          </p>
        </div>
        <ToggleGroup
          value={[view]}
          onValueChange={(value) => {
            const next = value[0] as "kanban" | "table" | undefined;
            if (!next) return;
            switchView(next);
          }}
        >
          <ToggleGroupItem value="kanban" aria-label="Канбан">
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Таблица">
            <Table2 className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <ProductsFilterBar
        projectOptions={projectOptions}
        clientOptions={clientOptions}
        engineerOptions={engineerOptions}
      />

      {view === "kanban" ? (
        <ProductsKanban
          initialProducts={products}
          canManage={canManage}
          showAmount={showAmount}
        />
      ) : (
        <ProductsTable
          products={products}
          total={total}
          page={page}
          pageSize={pageSize}
          showAmount={showAmount}
        />
      )}
    </div>
  );
}
