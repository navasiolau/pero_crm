import nextDynamic from "next/dynamic";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ComponentType } from "react";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SlotErrorBoundary } from "@/components/plugins/slot-error-boundary";
import { stageLabels, stageStyles } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { getPluginSettings } from "@/server/plugins/run-log";
import { getSlotContributions } from "@/server/plugins/slots";
import { getProjectFor, listClients, listManagers, listWorkers } from "@/server/projects/queries";

import { CommunicationsTab } from "./communications-tab";
import { FilesTab } from "./files-tab";
import { HistoryTab } from "./history-tab";
import { OverviewTab } from "./overview-tab";
import { TasksTab } from "./tasks-tab";

export const dynamic = "force-dynamic";

// Карточка проекта (§15): «Общее», «Работы и задачи», «Файлы», «Коммуникации»,
// «Финансы» (только админ/директор), «История» + вкладки плагинов (слот project.tab).
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const role = session.user.role;

  const project = await getProjectFor(session.user.id, role, id);
  if (!project) notFound();

  const canManage = ["ADMIN", "DIRECTOR", "MANAGER"].includes(role);
  const canEditTech = canManage || role === "ENGINEER";
  const showFinance = ["ADMIN", "DIRECTOR"].includes(role);
  const showAmount = showFinance || canManage || role === "ENGINEER";

  const [clients, managers, workers, changeLogs, contributions] =
    await Promise.all([
      listClients(),
      listManagers(),
      listWorkers(),
      prisma.changeLog.findMany({
        where: {
          OR: [
            { entity: "project", entityId: id },
            { entity: "task", newValue: { path: ["project"], equals: project.number } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      getSlotContributions("project.tab"),
    ]);

  const pluginTabs = await Promise.all(
    contributions.map(async (contribution) => ({
      ...contribution,
      settings: await getPluginSettings(contribution.pluginId),
      Component: nextDynamic(contribution.loader) as ComponentType<{
        projectId: string;
        settings: Record<string, unknown>;
      }>,
    })),
  );

  const authorIds = [
    ...new Set(
      [
        ...project.files.map((f) => f.uploadedById),
        ...project.communications.map((c) => c.createdById),
        ...project.stageHistory.map((h) => h.changedById),
        ...project.tasks.flatMap((t) => [t.createdById, t.doneById]),
      ].filter((v): v is string => !!v),
    ),
  ];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const uploaderNames = new Map(authors.map((user) => [user.id, user.name]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground"
          aria-label="К списку проектов"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold">
          {project.number} · {project.title}
        </h1>
        <Badge
          variant="outline"
          className={cn("border-transparent", stageStyles[project.stage].badge)}
        >
          {stageLabels[project.stage]}
        </Badge>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Общее</TabsTrigger>
          <TabsTrigger value="tasks">
            Работы и задачи ({project.tasks.length})
          </TabsTrigger>
          <TabsTrigger value="files">Файлы ({project.files.length})</TabsTrigger>
          <TabsTrigger value="communications">
            Коммуникации ({project.communications.length})
          </TabsTrigger>
          {showFinance ? <TabsTrigger value="finance">Финансы</TabsTrigger> : null}
          <TabsTrigger value="history">История</TabsTrigger>
          {pluginTabs.map((tab) => (
            <TabsTrigger key={tab.pluginId} value={tab.pluginId}>
              {tab.pluginName}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            project={project}
            canManage={canManage}
            canEditTech={canEditTech}
            showAmount={showAmount}
            clients={clients.map((client) => ({ id: client.id, name: client.name }))}
            managers={managers.map((manager) => ({ id: manager.id, name: manager.name }))}
          />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TasksTab
            projectId={project.id}
            tasks={project.tasks.map((task) => ({
              id: task.id,
              title: task.title,
              type: task.type,
              status: task.status,
              dueAt: task.dueAt?.toISOString() ?? null,
              assigneeId: task.assigneeId,
              assigneeName: task.assignee?.name ?? null,
              requiresPhoto: task.requiresPhoto,
              projectId: project.id,
              projectNumber: project.number,
              projectTitle: project.title,
              files: task.files,
              createdAt: task.createdAt.toISOString(),
              doneAt: task.doneAt?.toISOString() ?? null,
              doneByName: task.doneById
                ? (uploaderNames.get(task.doneById) ?? null)
                : null,
              createdByName: task.createdById
                ? (uploaderNames.get(task.createdById) ?? null)
                : null,
            }))}
            canManage={canManage}
            workers={workers.map((worker) => ({
              id: worker.id,
              name: worker.name,
              hint: worker.position ?? undefined,
            }))}
          />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <FilesTab
            projectId={project.id}
            files={project.files.map((file) => ({
              id: file.id,
              fileName: file.fileName,
              category: file.category,
              caption: file.caption,
              mimeType: file.mimeType,
              size: file.size,
              hasThumb: file.hasThumb,
              createdAt: file.createdAt.toISOString(),
              uploaderName: file.uploadedById
                ? (uploaderNames.get(file.uploadedById) ?? "—")
                : "—",
            }))}
            canEdit={canEditTech}
          />
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <CommunicationsTab
            projectId={project.id}
            entries={project.communications.map((entry) => ({
              id: entry.id,
              type: entry.type,
              text: entry.text,
              happenedAt: entry.happenedAt.toISOString(),
              authorName: entry.createdById
                ? (uploaderNames.get(entry.createdById) ?? "—")
                : "—",
            }))}
            canEdit={canEditTech}
          />
        </TabsContent>

        {showFinance ? (
          <TabsContent value="finance" className="mt-4">
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              Экономика проекта (платежи, расходы, маржа с индикатором)
              появится в фазе 5. Ожидаемая цена редактируется на вкладке
              «Общее».
            </div>
          </TabsContent>
        ) : null}

        <TabsContent value="history" className="mt-4">
          <HistoryTab
            stageHistory={project.stageHistory.map((entry) => ({
              id: entry.id,
              fromStage: entry.fromStage,
              toStage: entry.toStage,
              comment: entry.comment,
              createdAt: entry.createdAt.toISOString(),
              changedByName: entry.changedById
                ? (uploaderNames.get(entry.changedById) ?? "—")
                : "—",
            }))}
            changeLogs={changeLogs.map((entry) => ({
              id: entry.id,
              actorName: entry.actorName ?? entry.actorId,
              actorType: entry.actorType,
              action: entry.action,
              field: entry.field,
              oldValue: entry.oldValue,
              newValue: entry.newValue,
              createdAt: entry.createdAt.toISOString(),
            }))}
          />
        </TabsContent>

        {pluginTabs.map((tab) => (
          <TabsContent key={tab.pluginId} value={tab.pluginId} className="mt-4">
            <SlotErrorBoundary pluginName={tab.pluginName}>
              <tab.Component projectId={project.id} settings={tab.settings} />
            </SlotErrorBoundary>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
