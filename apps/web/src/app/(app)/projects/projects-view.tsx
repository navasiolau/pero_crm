"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Plus, Table2 } from "lucide-react";
import type { ProjectStage } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useListParams } from "@/lib/list-params";

import { CreateProjectDialog } from "./create-project-dialog";
import { KanbanBoard } from "./kanban-board";
import { ProjectsFilterBar } from "./filter-bar";
import { ProjectsTable } from "./projects-table";

export interface ProjectCard {
  id: string;
  number: string;
  title: string;
  stage: ProjectStage;
  stageChangedAt: string;
  totalPrice: string | null; // Σ цен изделий, в валюте проекта
  currency: string;
  clientId: string;
  clientName: string;
  managerName: string | null;
  productsCount: number;
  tasksCount: number;
  filesCount: number;
  hasMaterialShortage: boolean; // бейдж «Нехватка материалов» (§12)
}

export interface SelectOption {
  id: string;
  name: string;
  hint?: string; // должность/телефон — вторая строка в списках
}

// Раздел «Проекты»: фильтры в URL, канбан (по умолчанию) / таблица,
// полное состояние сохраняется общим ListParamsProvider (§7).
// Фильтрация/сортировка/пагинация — на сервере (listProjects).
export function ProjectsView({
  view,
  projects,
  total,
  page,
  pageSize,
  canManage,
  showAmount,
  clients,
  managers,
  engineers,
}: {
  view: "kanban" | "table";
  // Канбан — все отфильтрованные проекты; таблица — одна страница
  projects: ProjectCard[];
  total: number;
  page: number;
  pageSize: number;
  canManage: boolean;
  showAmount: boolean;
  clients: SelectOption[];
  managers: SelectOption[];
  engineers: SelectOption[];
}) {
  const router = useRouter();
  const { set } = useListParams();
  const [createOpen, setCreateOpen] = useState(false);

  function switchView(next: "kanban" | "table") {
    set({ view: next });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Проекты</h1>
        <div className="flex items-center gap-2">
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
          {canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Проект
            </Button>
          ) : null}
        </div>
      </div>

      <ProjectsFilterBar
        clients={clients}
        managers={managers}
        engineers={engineers}
      />

      {view === "kanban" ? (
        <KanbanBoard
          initialProjects={projects}
          canManage={canManage}
          showAmount={showAmount}
        />
      ) : (
        <ProjectsTable
          projects={projects}
          total={total}
          page={page}
          pageSize={pageSize}
          showAmount={showAmount}
          onOpen={(id) => router.push(`/projects/${id}`)}
        />
      )}

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        clients={clients}
        managers={managers}
        onCreated={(id) => router.push(`/projects/${id}`)}
      />
    </div>
  );
}
