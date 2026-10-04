"use client";

import { EntityListFilterBar } from "@/components/entity-list-filter-bar";
import type { MultiSelectFilterOption } from "@/components/ui/multi-select-filter";
import { PRODUCT_STATUSES } from "@/lib/product-statuses";

export function ProductsFilterBar({ projectOptions, clientOptions, engineerOptions }: {
  projectOptions: MultiSelectFilterOption[];
  clientOptions: MultiSelectFilterOption[];
  engineerOptions: MultiSelectFilterOption[];
}) {
  return (
    <EntityListFilterBar
      section="products"
      searchPlaceholder="Номер, название, проект, клиент…"
      fields={[
        {
          queryKey: "status", label: "Статус", allLabel: "Все статусы",
          searchPlaceholder: "Поиск статуса…", width: "w-44",
          options: PRODUCT_STATUSES.map((item) => ({ value: item.id, label: item.label })),
        },
        {
          queryKey: "project", label: "Проект", allLabel: "Все проекты",
          searchPlaceholder: "Поиск проекта…", width: "w-40", options: projectOptions,
        },
        {
          queryKey: "client", label: "Клиент", allLabel: "Все клиенты",
          searchPlaceholder: "Поиск клиента…", width: "w-48", options: clientOptions,
        },
        {
          queryKey: "engineer", label: "Инженер", allLabel: "Все инженеры",
          searchPlaceholder: "Поиск инженера…", width: "w-44", options: engineerOptions,
        },
      ]}
    />
  );
}
