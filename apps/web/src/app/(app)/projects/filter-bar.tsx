"use client";

import { EntityListFilterBar } from "@/components/entity-list-filter-bar";
import { STAGES } from "@/lib/stages";
import { visibleProjectStages } from "@/lib/project-stage-visibility";
import type { Role } from "@prisma/client";

import type { SelectOption } from "./projects-view";

export function ProjectsFilterBar({ actorRoles, clients, managers, engineers, hideEngineer, identitySearch, onSearchDraftChange, onModalActiveChange }: {
  actorRoles?: readonly Role[];
  clients: SelectOption[];
  managers: SelectOption[];
  engineers: SelectOption[];
  hideEngineer?: boolean;
  identitySearch?: boolean;
  onSearchDraftChange?: (query: string) => void;
  onModalActiveChange?: (active: boolean) => void;
}) {
  return (
    <EntityListFilterBar
      section="projects"
      searchPlaceholder={identitySearch ? "Номер, название…" : "Номер, название, клиент…"}
      onSearchDraftChange={onSearchDraftChange}
      onModalActiveChange={onModalActiveChange}
      fields={[
        {
          queryKey: "stage", label: "Статус", allLabel: "Все статусы",
          searchPlaceholder: "Поиск статуса…", width: "w-40",
          options: (actorRoles ? visibleProjectStages(actorRoles) : STAGES).map((item) => ({ value: item.id, label: item.label })),
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
