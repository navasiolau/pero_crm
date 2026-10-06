"use client";

import { EntityListFilterBar } from "@/components/entity-list-filter-bar";
import { STAGES } from "@/lib/stages";

import type { SelectOption } from "./projects-view";

export function ProjectsFilterBar({ clients, managers, engineers, hideEngineer }: {
  clients: SelectOption[];
  managers: SelectOption[];
  engineers: SelectOption[];
  hideEngineer?: boolean;
}) {
  return (
    <EntityListFilterBar
      section="projects"
      searchPlaceholder="Номер, название, клиент…"
      fields={[
        {
          queryKey: "stage", label: "Статус", allLabel: "Все статусы",
          searchPlaceholder: "Поиск статуса…", width: "w-40",
          options: STAGES.map((item) => ({ value: item.id, label: item.label })),
        },
        {
          queryKey: "client", label: "Клиент", allLabel: "Все клиенты",
          searchPlaceholder: "Поиск клиента…", width: "w-48",
          options: clients.map((item) => ({ value: item.id, label: item.name })),
        },
        {
          queryKey: "manager", label: "Менеджер", allLabel: "Все менеджеры",
          searchPlaceholder: "Поиск менеджера…", width: "w-44",
          options: managers.map((item) => ({ value: item.id, label: item.name })),
        },
        ...(hideEngineer ? [] : [{
          queryKey: "engineer", label: "Инженер", allLabel: "Все инженеры",
          searchPlaceholder: "Поиск инженера…", width: "w-44",
          options: engineers.map((item) => ({ value: item.id, label: item.name })),
        }]),
      ]}
    />
  );
}
