"use client";
import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CardNumber } from "@/components/card-number";
import { Badge } from "@/components/ui/badge";
import { ProductHeroImage } from "@/components/product-hero-image";
import { projectKanbanAmount, projectStageDays } from "@/lib/project-kanban-values";
import { cn } from "@/lib/utils";
import type { ProjectCard } from "@/app/(app)/projects/projects-view";
export function ProjectKanbanCard({ project, showAmount, dragging=false, onOpen }: { project: ProjectCard; showAmount: boolean; dragging?: boolean; onOpen?: (id:string)=>void }) {
  const days=projectStageDays(project.stageChangedAt);
  const ageClass=days!==null&&days>=14?"bg-destructive/15 text-destructive":days!==null&&days>=7?"bg-amber-500/15 text-amber-700":"bg-muted text-muted-foreground";
  return <Card data-slot="project-kanban-card" className={cn("cursor-pointer select-none gap-0 overflow-hidden py-0",dragging&&"rotate-2 shadow-lg")}>
    {project.coverFile?<button type="button" aria-label={`Открыть проект ${project.number}`} className="relative block aspect-[3/4] w-full shrink-0 overflow-hidden bg-muted/30" disabled={dragging||!onOpen} onClick={event=>{event.stopPropagation();if(!dragging)onOpen?.(project.id);}}><ProductHeroImage sketch={project.coverFile} alt={`Обложка проекта ${project.number}`} preview="card" errorDisplay="icon" className="h-full w-full object-cover object-center"/></button>:null}
    <CardContent className="flex min-w-0 flex-col gap-1.5 p-3">
      <div className="flex min-w-0 items-center justify-between gap-2 pr-10"><span className="min-w-0 break-all text-xl"><CardNumber>{project.number}</CardNumber></span><Badge className={cn("shrink-0 text-xs",ageClass)}>{days??"—"} дн.</Badge></div>
      <div className="break-words text-sm">{project.title}</div>
      <div className="break-words text-xs text-muted-foreground">{project.clientName}</div>
      {showAmount?<div data-project-amount className="break-words text-sm">{projectKanbanAmount(project.totalPrice,project.currency)}</div>:null}
      {project.hasMaterialShortage?<Badge variant="destructive" className="text-xs"><TriangleAlert/>Нехватка материалов</Badge>:null}
    </CardContent>
  </Card>;
}
