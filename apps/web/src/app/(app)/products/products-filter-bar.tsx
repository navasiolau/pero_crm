"use client";

import { EntityListFilterBar } from "@/components/entity-list-filter-bar";
import type { MultiSelectFilterOption } from "@/components/ui/multi-select-filter";
import type { Role } from "@prisma/client";
import { visibleProductStatuses } from "@/lib/product-statuses";

export function ProductsFilterBar({ actorRoles, projectOptions, clientOptions, engineerOptions, hideEngineer, identitySearch, onSearchDraftChange, onModalActiveChange }: {
  actorRoles?: readonly Role[];
  projectOptions: MultiSelectFilterOption[];
  clientOptions: MultiSelectFilterOption[];
  engineerOptions: MultiSelectFilterOption[];
  hideEngineer?: boolean;
  identitySearch?: boolean;
  onSearchDraftChange?: (query: string) => void;
  onModalActiveChange?: (active: boolean) => void;
}) {
  return (
    <EntityListFilterBar
      section="products"
      searchPlaceholder={identitySearch ? "Номер, название…" : "Номер, название, проект, клиент…"}
      onSearchDraftChange={onSearchDraftChange}
      onModalActiveChange={onModalActiveChange}
      fields={[
        {
          queryKey: "status", label: "Статус", allLabel: "Все статусы",
          searchPlaceholder: "Поиск статуса…", width: "w-44",
          options: visibleProductStatuses(actorRoles ?? [], actorRoles?.includes("MANAGER")).map((item) => ({ value: item.id, label: item.label })),
        },
        {
          queryKey: "project", label: "Проект", allLabel: "Все проекты",
          searchPlaceholder: "Поиск проекта…", width: "w-40", options: projectOptions,
        },
        {
          queryKey: "client", label: "Клиент", allLabel: "Все клиенты",
          searchPlaceholder: "Поиск клиента…", width: "w-48", options: clientOptions,
        },
        ...(hideEngineer ? [] : [{
          queryKey: "engineer", label: "Инженер", allLabel: "Все инженеры",
          searchPlaceholder: "Поиск инженера…", width: "w-44", options: engineerOptions,
        }]),
      ]}
    />
  );
}
