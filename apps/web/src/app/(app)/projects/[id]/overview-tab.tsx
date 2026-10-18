"use client";
import type { ProjectStage } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { InlineSelectField, InlineTextField } from "@/components/inline-fields";
import { ProjectStageControl } from "@/components/project-stage-control";
import { useProjectInline } from "@/components/project-inline-provider";
import type { ProductClientContact } from "@/lib/product-client-contacts";
import { ProjectInlineContacts, ProjectConfirmedTotal } from "@/components/project-inline-fields";
import { formatDateTime } from "@/lib/format";
import type { SelectOption } from "../projects-view";
import {ProjectCover} from "@/components/project-cover";
import type {ProjectCoverPreview} from "@/server/projects/cover-contract";
export interface OverviewProject {
 id:string;number:string;stage:ProjectStage;stageChangedAt:Date;currency:string;createdAt:Date;
 refusalReason:string|null;refusalComment:string|null;reclamationReason:string|null;reclamationDescription:string|null;reclamationFault:string|null;
 coverFile?:ProjectCoverPreview|null;
}
export function OverviewTab({project,createdByName,canManage,showAmount,clients,managers,productEngineers,doneAt}:{project:OverviewProject;createdByName:string|null;canManage:boolean;showAmount:boolean;clients:ProductClientContact[];managers:SelectOption[];productEngineers:SelectOption[];doneAt:string|null}) {
 const inline=useProjectInline();const {controller}=inline;
 return <div className="grid min-w-0 gap-4 lg:grid-cols-2"><Card className="min-w-0"><CardHeader><CardTitle className="text-lg">Данные проекта</CardTitle></CardHeader><CardContent className="flex min-w-0 flex-col gap-3">
 <InlineTextField id="project-inline-title" label="Название заказа" controller={controller("title")} readOnly={!canManage}/>
 <div className="flex min-w-0 flex-col gap-1.5"><Label>Статус</Label><ProjectStageControl projectId={project.id} stage={inline.stage} canManage={canManage} onBeforeChange={inline.flush} onConfirmed={inline.confirmStage}/></div>
<ProjectInlineContacts canManage={canManage} clients={clients}/>
 <InlineSelectField id="project-inline-manager" label="Менеджер" controller={controller("managerId")} readOnly={!canManage} options={managers.map(manager=>({value:manager.id,label:manager.name}))} allowClear/>
 <div className="flex min-w-0 flex-col gap-1.5"><Label>Инженеры назначенные в Изделиях</Label><div aria-readonly="true" className="min-h-9 min-w-0 break-words rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{productEngineers.length?productEngineers.map(engineer=>engineer.name).join(" · "):"—"}</div></div>
 {showAmount?<div className="min-w-0 space-y-3"><InlineTextField id="project-inline-servicesTotal" label={`Общая сумма услуг, ${project.currency}`} inputMode="decimal" controller={controller("servicesTotal")} readOnly={!canManage||project.currency!=="BYN"}/><div className="grid min-w-0 gap-3 sm:grid-cols-3">{(["delivery","unloading","installation"] as const).map((field,index)=><InlineTextField key={field} id={`project-inline-${field}`} label={`${["Доставка","Выгрузка","Монтаж"][index]}, ${project.currency}`} inputMode="decimal" controller={controller(field)} readOnly={!canManage||project.currency!=="BYN"}/>)}</div><p className="text-xs text-muted-foreground">Общая сумма заменяет разбивку. Изменение доставки, выгрузки или монтажа переключает услуги на разбивку.</p></div>:null}
 </CardContent></Card><ProjectCover projectId={project.id} cover={project.coverFile??null} canManage={canManage} beforeMutation={inline.flush} registerGuard={inline.registerGuard}/><Card className="min-w-0"><CardHeader><CardTitle className="text-lg">Сведения</CardTitle></CardHeader><CardContent className="min-w-0 space-y-3 text-sm">
 {showAmount?<ProjectConfirmedTotal/>:null}
 <p className="break-words text-muted-foreground">Создан: {formatDateTime(project.createdAt)}{createdByName?` · ${createdByName}`:""}</p>
 {doneAt?<p className="break-words text-muted-foreground">Завершён: {formatDateTime(doneAt)}</p>:null}
 <p className="break-words text-muted-foreground">В статусе с: {formatDateTime(project.stageChangedAt)}</p>
 {project.stage==="REFUSED"?<div className="space-y-1 rounded-md border border-destructive/30 p-3"><p className="font-medium">Отказ</p><p className="break-words">{project.refusalReason}</p>{project.refusalComment?<p className="break-words">{project.refusalComment}</p>:null}</div>:null}
 {project.stage==="RECLAMATION"?<div className="space-y-1 rounded-md border border-amber-500/30 p-3"><p className="font-medium">Рекламация</p><p className="break-words">{project.reclamationReason}</p><p className="break-words">{project.reclamationDescription}</p><p className="break-words">Ответственность: {project.reclamationFault}</p></div>:null}
 </CardContent></Card></div>;
}
