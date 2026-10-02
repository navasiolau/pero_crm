"use client";

import { useEffect, useRef, useState } from "react";
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
import { ClipboardList, Package, Paperclip, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { ProjectStage } from "@prisma/client";

import { DragHandle } from "@/components/drag-handle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatAmount } from "@/lib/format";
import { STAGES, daysOnStage, stageLabels, stageStyles } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { patchProjectStage } from "@/server/projects/stage-actions";
import type {ProjectStagePatch,StageExtras} from "@/server/projects/stage-contract";

import type { ProjectCard } from "./projects-view";
import { StageFormDialog, type StageFormRequest } from "./stage-form-dialog";

export { formatAmount };

function daysBadgeClass(days: number): string {
  if (days >= 14) return "bg-destructive/15 text-destructive";
  if (days >= 7) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

function ProjectCardView({
  project,
  showAmount,
  dragging,
}: {
  project: ProjectCard;
  showAmount: boolean;
  dragging?: boolean;
}) {
  const days = daysOnStage(project.stageChangedAt);
  return (
    <Card
      className={cn(
        "cursor-pointer select-none",
        dragging && "rotate-2 shadow-lg",
      )}
    >
      <CardContent className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2 pr-10">
          <span className="text-sm font-medium">{project.number}</span>
          <Badge className={cn("text-xs", daysBadgeClass(days))}>
            {days} дн.
          </Badge>
        </div>
        <div className="text-sm">{project.title}</div>
        <div className="text-xs text-muted-foreground">{project.clientName}</div>
        {project.hasMaterialShortage ? (
          <Badge variant="destructive" className="text-xs">
            <TriangleAlert />
            Нехватка материалов
          </Badge>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {showAmount ? (
            <span>{formatAmount(project.totalPrice, project.currency)}</span>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-0.5">
              <Package className="size-3.5" /> {project.productsCount}
            </span>
            <span className="flex items-center gap-0.5">
              <ClipboardList className="size-3.5" /> {project.tasksCount}
            </span>
            <span className="flex items-center gap-0.5">
              <Paperclip className="size-3.5" /> {project.filesCount}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function DraggableCard({
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
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("relative", isDragging && "opacity-40")}
      onClick={() => onOpen(project.id)}
    >
      {canManage && <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={project.title} />}
      <ProjectCardView project={project} showAmount={showAmount} />
    </div>
  );
}

function StageColumn({
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
}

// Канбан проектов (§7): колонки = этапы §6, свободные переходы,
// оптимистичное обновление с откатом; мини-формы для Отказа/Рекламации (§6).
// Порядок карточек и фильтрация — с сервера (listProjects, новые сверху);
// после смены этапа revalidate приносит новый список — синхронизируемся.
export function KanbanBoard({
  initialProjects,
  canManage,
  showAmount,
}: {
  initialProjects: ProjectCard[];
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
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

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
        <div data-slot="kanban-scroll" className="flex min-w-0 gap-3 overflow-x-auto pb-4">
          {STAGES.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              projects={projects.filter((project) => project.stage === stage.id)}
              showAmount={showAmount}
              canManage={canManage}
              onOpen={(id) => router.push(`/projects/${id}`)}
            />
          ))}
        </div>
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
