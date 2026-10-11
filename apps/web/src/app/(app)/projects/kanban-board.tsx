"use client";

import { KanbanScrollArea } from "@/components/kanban-scroll-area";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { ProjectStage } from "@prisma/client";

import { DragHandle } from "@/components/drag-handle";
import { Badge } from "@/components/ui/badge";
import { ProjectKanbanCard as ProjectCardView } from "@/components/project-kanban-card";
import { formatAmount } from "@/lib/format";
import { STAGES, stageLabels, stageStyles } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { patchProjectStage } from "@/server/projects/stage-actions";
import type {ProjectStagePatch,StageExtras} from "@/server/projects/stage-contract";

import type { ProjectCard } from "./projects-view";
import { StageFormDialog, type StageFormRequest } from "./stage-form-dialog";

export { formatAmount };

const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };

const DraggableCard = memo(function DraggableCard({
  project,
  showAmount,
  canManage,
  onOpen,
}: {
  project: ProjectCard;
  showAmount: boolean;
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } =
    useDraggable({ id: project.id, disabled: !canManage });

  return (
    <div
      ref={setNodeRef}
      data-kanban-card-id={project.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("relative", isDragging && "opacity-40")}
      onClick={() => onOpen(project.id)}
    >
      {canManage && <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={project.title} />}
      <ProjectCardView project={project} showAmount={showAmount} dragging={isDragging} onOpen={onOpen} />
    </div>
  );
});

const StageColumn = memo(function StageColumn({
  stage,
  projects,
  showAmount,
  canManage,
  onOpen,
}: {
  stage: (typeof STAGES)[number];
  projects: ProjectCard[];
  showAmount: boolean;
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const style = stageStyles[stage.id];
  return (
    <div
      ref={setNodeRef}
      data-slot="kanban-column"
      className={cn(
        "flex w-64 shrink-0 flex-col gap-2 rounded-xl border p-2 transition-colors",
        style.column,
        stage.service && "border-2",
        isOver && "border-primary/60 bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <span className={cn("text-sm font-medium", style.header)}>
          {stage.label}
        </span>
        <Badge variant="secondary">{projects.length}</Badge>
      </div>
      <div className="flex min-h-24 flex-col gap-2">
        {projects.map((project) => (
          <DraggableCard
            key={project.id}
            project={project}
            showAmount={showAmount}
            canManage={canManage}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
});

// Канбан проектов (§7): колонки = этапы §6, свободные переходы,
// оптимистичное обновление с откатом; мини-формы для Отказа/Рекламации (§6).
// Порядок карточек и фильтрация — с сервера (listProjects, новые сверху);
// после смены этапа revalidate приносит новый список — синхронизируемся.
export function KanbanBoard({
  initialProjects,
  searchText = "",
  searchReady = false,
  canManage,
  showAmount,
}: {
  initialProjects: ProjectCard[];
  // Без подтверждённой пары query/rows обычный caller не запускает поиск.
  searchText?: string;
  searchReady?: boolean;
  canManage: boolean;
  showAmount: boolean;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [formRequest, setFormRequest] = useState<StageFormRequest | null>(null);
  const [errors,setErrors]=useState<Record<string,string>>({});
  const inflight=useRef(new Set<string>());
  const retries=useRef<Record<string,ProjectStagePatch>>({});

  // Синхронизация с сервером: фильтры/этапы меняются на сервере, а
  // перетаскивание в «Завершён»/«Отказ» при активной галочке убирает
  // карточку с доски (сервер её отфильтровал)
  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
  );

  const columns = useMemo(() => STAGES.map(stage => ({
    stage, projects: projects.filter(project => project.stage === stage.id),
  })), [projects]);
  const onOpen = useCallback((id: string) => router.push(`/projects/${id}`), [router]);

  function applyStage(projectId: string, toStage: ProjectStage) {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              stage: toStage,
              stageChangedAt: new Date().toISOString(),
            }
          : project,
      ),
    );
  }

  async function moveTo(
    projectId: string,
    fromStage: ProjectStage,
    toStage: ProjectStage,
    extras?: StageExtras,
  ) {
    if(inflight.current.has(projectId))return false;
    inflight.current.add(projectId);setErrors({});
    const candidate={projectId,toStage,expectedStage:fromStage,extras};
    if(!retries.current[projectId]||JSON.stringify({...retries.current[projectId],clientMutationId:undefined})!==JSON.stringify(candidate))retries.current[projectId]={...candidate,clientMutationId:crypto.randomUUID()};
    try {
      const result=await patchProjectStage(retries.current[projectId]);
      if(!result.ok){delete retries.current[projectId];setErrors(result.errors??{});toast.error(result.error??"Не удалось сменить статус");return false;}
      delete retries.current[projectId];applyStage(projectId,result.stage??toStage);
      toast.success(`Статус: ${stageLabels[toStage]}`);return true;
    } catch {toast.error("Ответ не получен. Повторите сохранение");return false;}
    finally {inflight.current.delete(projectId);}
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const project = projects.find((item) => item.id === String(active.id));
    const toStage = over.id as ProjectStage;
    if (!project || project.stage === toStage) return;

    // Переходы, требующие добора данных прямо при перетаскивании (§6)
    if (toStage === "REFUSED" || toStage === "RECLAMATION") {
      setFormRequest({
        projectId: project.id,
        fromStage: project.stage,
        toStage,
      });
      return;
    }
    void moveTo(project.id, project.stage, toStage);
  }

  const activeProject = projects.find((project) => project.id === activeId);

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <KanbanScrollArea label="Канбан проектов" searchFocus={{
          query: searchText,
          cardId: projects.find(item => item.number === searchText.trim())?.id ?? null,
          ready: searchReady && projects === initialProjects && !activeId,
        }}>
          {columns.map(({ stage, projects }) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              projects={projects}
              showAmount={showAmount}
              canManage={canManage}
              onOpen={onOpen}
            />
          ))}
        </KanbanScrollArea>
        <DragOverlay>
          {activeProject ? (
            <ProjectCardView project={activeProject} showAmount={showAmount} dragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      <StageFormDialog
        request={formRequest} errors={errors}
        onClose={() => setFormRequest(null)}
        onSubmit={async (request, values) => {
          const success = await moveTo(
            request.projectId,
            request.fromStage,
            request.toStage,
            values,
          );
          if (success) setFormRequest(null);
          return success;
        }}
      />
    </>
  );
}
