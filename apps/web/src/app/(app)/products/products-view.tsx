"use client";

import { useState } from "react";
import { LayoutGrid, Table2 } from "lucide-react";
import type { ProductStatus, ProjectStage, Role } from "@prisma/client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useListParams } from "@/lib/list-params";
import type { SketchFilePreview } from "@/lib/product-hero";

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
  quantity: number;
  currency: string;
  projectId: string;
  projectStage?: ProjectStage;
  projectNumber: string;
  projectTitle: string;
  clientId: string;
  clientName: string;
  engineerName: string | null;
  engineerId: string | null;
  isEngineeringParticipant: boolean;
  hasB3d: boolean;
  noModel: boolean;
  sketchFile: SketchFilePreview | null;
}

// Раздел «Изделия»: канбан (по умолчанию) / таблица, фильтры в URL —
// те же принципы, что у проектов. Порядок — «новые сверху» (сервер).
export function ProductsView({
  view,
  resolvedQuery,
  products,
  total,
  page,
  pageSize,
  canManage,
  actorRoles,
  showAmount,
  projectOptions,
  clientOptions,
  engineerOptions,
  hideEngineerFilter,
}: {
  view: "kanban" | "table";
  resolvedQuery: string;
  // Канбан — все отфильтрованные изделия; таблица — одна страница
  products: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  canManage: boolean;
  actorRoles: readonly Role[];
  showAmount: boolean;
  projectOptions: { value: string; label: string; hint?: string }[];
  clientOptions: { value: string; label: string; hint?: string }[];
  engineerOptions: { value: string; label: string; hint?: string }[];
  hideEngineerFilter?: boolean;
}) {
  const { set, query, pending } = useListParams();
  const [searchText, setSearchText] = useState(() => new URLSearchParams(resolvedQuery).get("q") ?? "");
  const [filterOverlayActive, setFilterOverlayActive] = useState(false);

  function switchView(next: "kanban" | "table") {
    set({ view: next });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Изделия</h1>
          <p className="text-sm text-muted-foreground">
            Доступные вам изделия — карточка открывается по клику; разрешённый
            переход статуса доступен перетаскиванием
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
        identitySearch={view === "kanban"}
        onSearchDraftChange={setSearchText}
        onModalActiveChange={setFilterOverlayActive}
        projectOptions={projectOptions}
        clientOptions={clientOptions}
        engineerOptions={engineerOptions}
        hideEngineer={hideEngineerFilter}
      />

      {view === "kanban" ? (
        <ProductsKanban
          searchText={searchText}
          searchReady={!pending && query === resolvedQuery && !filterOverlayActive
            && searchText.trim() === (new URLSearchParams(query).get("q") ?? "")}
          initialProducts={products}
          canManage={canManage}
          actorRoles={actorRoles}
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
