import nextDynamic from "next/dynamic";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ComponentType } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SlotErrorBoundary } from "@/components/plugins/slot-error-boundary";
import { displayClientName } from "@/lib/labels";
import {
  FINANCE_ROLES,
  MANAGER_ROLES,
  OFFICE_ROLES,
  hasAnyRole,
  hasRole,
} from "@/lib/roles";
import { stageLabels, stageStyles } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { getPluginSettings } from "@/server/plugins/run-log";
import { getFileStageConfig } from "@/server/files/stage-config";
import { getSlotContributions } from "@/server/plugins/slots";
import { getProjectEconomics } from "@/server/finance/queries";
import { getProjectFor, listClients, listEngineers, listManagers, listWorkers } from "@/server/projects/queries";
import { mapTaskDetails } from "@/server/tasks/queries";
import { getProjectMaterials } from "@/server/warehouse/queries";
import { hasFullProjectVisibility } from "@/server/access/visibility";
import { allocatedWorkQuantity } from "@/lib/work-shares";

import { CommunicationsTab } from "./communications-tab";
import { FilesTab } from "./files-tab";
import { FinanceTab } from "./finance-tab";
import { HistoryTab } from "./history-tab";
import { MaterialsSummaryTab } from "./materials-summary-tab";
import { OverviewTab } from "./overview-tab";
import { ProductsTab } from "./products-tab";
import { TasksTab } from "./tasks-tab";

export const dynamic = "force-dynamic";

// Карточка проекта = заказ клиента (§15): «Общее», «Изделия», «Задачи»,
// «Файлы», «Коммуникации», «Финансы» (админ/директор/бухгалтер),
// «Материалы» (сводно по изделиям, только просмотр), «История»
// + вкладки плагинов (слот project.tab).
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const role = session.user.roles;

  const project = await getProjectFor(session.user.id, role, id);
  if (!project) notFound();

  const canManage = hasAnyRole(role, MANAGER_ROLES);
  const canEditTech = canManage || hasRole(role, "ENGINEER");
  const showFinance = hasAnyRole(role, FINANCE_ROLES);
  const showAmount = showFinance || canManage || hasRole(role, "ENGINEER");
  // Склад (§12): вкладка «Материалы» — офисные роли (+ бухгалтер на просмотр)
  const showMaterials = hasAnyRole(role, OFFICE_ROLES);

  // Группировка файлов по этапам (плагин file-stages), если включён.
  const stageConfig = await getFileStageConfig();

  const productIds = project.products.map((product) => product.id);

  const [clients, managers, engineers, workers, changeLogs, contributions, priceItems, economics, cashAccounts, expenseArticles, materialsGroups] =
    await Promise.all([
      listClients(session.user),
      listManagers(),
      listEngineers(),
      listWorkers(),
      prisma.changeLog.findMany({
        where: {
          OR: [
            ...(hasFullProjectVisibility(session.user) ? [{ entity: "project", entityId: id }] : []),
            { entity: "product", entityId: { in: productIds } },
            ...(hasFullProjectVisibility(session.user) ? [{ entity: "task", entityId: { in: project.tasks.map((task) => task.id) } }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      hasFullProjectVisibility(session.user) ? getSlotContributions("project.tab") : Promise.resolve([]),
      prisma.priceItem.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
      }),
      // Данные вкладки «Финансы» (§11) — админу/директору/бухгалтеру
      showFinance ? getProjectEconomics(project.id) : Promise.resolve(null),
      showFinance
        ? prisma.cashAccount.findMany({
            where: { active: true },
            orderBy: { createdAt: "asc" },
          })
        : Promise.resolve([]),
      showFinance
        ? prisma.expenseArticle.findMany({
            where: { active: true },
            orderBy: { createdAt: "asc" },
          })
        : Promise.resolve([]),
      // Сводная потребность по изделиям (вкладка «Материалы», read-only)
      showMaterials
        ? Promise.all(project.products.map((product) => getProjectMaterials(product.id, session.user)))
        : Promise.resolve([]),
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
        project.createdById,
        ...project.files.map((f) => f.uploadedById),
        ...project.communications.map((c) => c.createdById),
        ...project.payments.map((p) => p.createdById),
        ...project.stageHistory.map((h) => h.changedById),
        ...project.products.flatMap((p) => p.statusHistory.map((h) => h.changedById)),
        ...project.tasks.flatMap((t) => [t.createdById, t.doneById]),
      ].filter((v): v is string => !!v),
    ),
  ];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const uploaderNames = new Map(authors.map((user) => [user.id, user.name]));

  // Стоимость проекта = Σ цен изделий + доставка/выгрузка/монтаж (валюта проекта)
  const productsTotal = project.products.reduce(
    (sum, product) => sum + Number(product.expectedPrice ?? 0),
    0,
  );
  const totalPrice =
    productsTotal +
    Number(project.delivery ?? 0) +
    Number(project.unloading ?? 0) +
    Number(project.installation ?? 0);
  // Первоначальная цена — первая цена КП клиенту (хранится на проекте;
  // правят менеджмент в карточке и telegram-бот; бэкфилл — Σ по изделиям)
  const initialPrice =
    project.initialPrice === null ? null : Number(project.initialPrice);
  // Дата завершения — последний переход в «Завершён» из истории этапов
  const doneEntry = project.stageHistory.find((entry) => entry.toStage === "DONE");
  // Нехватка материалов — хотя бы по одному изделию (§12)
  const hasShortage = materialsGroups.some((group) => group.hasShortage);
  // Сводная история статусов изделий (свежие сверху)
  const productHistory = project.products
    .flatMap((product) =>
      product.statusHistory.map((entry) => ({
        id: entry.id,
        productNumber: product.number,
        productTitle: product.title,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        comment: entry.comment,
        createdAt: entry.createdAt,
        changedById: entry.changedById,
      })),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

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
        {showMaterials && hasShortage ? (
          <Badge variant="destructive">
            <TriangleAlert />
            Нехватка материалов
          </Badge>
        ) : null}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Общее</TabsTrigger>
          <TabsTrigger value="products">
            Изделия ({project.products.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">
            Задачи ({project.tasks.length})
          </TabsTrigger>
          <TabsTrigger value="files">Файлы ({project.files.length})</TabsTrigger>
          <TabsTrigger value="communications">
            Коммуникации ({project.communications.length})
          </TabsTrigger>
          {showFinance ? <TabsTrigger value="finance">Финансы</TabsTrigger> : null}
          {showMaterials ? <TabsTrigger value="materials">Материалы</TabsTrigger> : null}
          <TabsTrigger value="history">История</TabsTrigger>
          {pluginTabs.map((tab) => (
            <TabsTrigger key={tab.pluginId} value={tab.pluginId}>
              {tab.pluginName}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            // Плоский объект по составу OverviewProject: сырой Prisma-проект
            // содержит Decimal (works/tasks/payments) — через RSC-границу нельзя.
            project={{
              id: project.id,
              number: project.number,
              title: project.title,
              stage: project.stage,
              stageChangedAt: project.stageChangedAt,
              currency: project.currency,
              address: project.address,
              initialPrice:
                project.initialPrice === null ? null : Number(project.initialPrice),
              delivery:
                project.delivery === null ? null : Number(project.delivery),
              unloading:
                project.unloading === null ? null : Number(project.unloading),
              installation:
                project.installation === null
                  ? null
                  : Number(project.installation),
              clientId: project.clientId,
              managerId: project.managerId,
              createdAt: project.createdAt,
              refusalReason: project.refusalReason,
              refusalComment: project.refusalComment,
              reclamationReason: project.reclamationReason,
              reclamationDescription: project.reclamationDescription,
              reclamationFault: project.reclamationFault,
              client: project.client,
            }}
            totalPrice={totalPrice}
            productsTotal={productsTotal}
            initialPrice={initialPrice}
            createdByName={
              project.createdById
                ? (uploaderNames.get(project.createdById) ?? null)
                : null
            }
            doneAt={doneEntry ? doneEntry.createdAt.toISOString() : null}
            canManage={canManage}
            showAmount={hasFullProjectVisibility(session.user)}
            clients={clients.map((client) => ({ id: client.id, name: displayClientName(client) }))}
            managers={managers.map((manager) => ({ id: manager.id, name: manager.name }))}
            productEngineers={project.products
              .map((product) => product.engineer)
              .filter(
                (engineer, index, all) =>
                  engineer &&
                  all.findIndex((item) => item?.id === engineer.id) === index,
              )
              .map((engineer) => ({ id: engineer!.id, name: engineer!.name }))}
          />
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <ProductsTab
            projectId={project.id}
            currency={project.currency}
            initialProducts={project.products.map((product) => ({
              id: product.id,
              number: product.number,
              title: product.title,
              status: product.status,
              statusChangedAt: product.statusChangedAt.toISOString(),
              expectedPrice: product.expectedPrice?.toString() ?? null,
              engineerName: product.engineer?.name ?? null,
            }))}
            canManage={canManage}
            showAmount={showAmount}
            engineerOptions={engineers.map((engineer) => ({
              value: engineer.id,
              label: engineer.name,
            }))}
          />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TasksTab
            projectId={project.id}
            products={project.products.map((product) => ({
              id: product.id,
              number: product.number,
              title: product.title,
            }))}
            tasks={await mapTaskDetails(project.tasks, session.user)}
            works={project.works.map((work) => ({
              id: work.id,
              title: work.title,
              quantity: work.quantity.toString(),
              allocated: allocatedWorkQuantity(work.tasks),
              priceSnapshot: work.priceSnapshot.toString(),
              total: work.total.toString(),
              linkedTask: work.tasks[0]
                ? { id: work.tasks[0].id, title: work.tasks[0].title, status: work.tasks[0].status }
                : null,
            }))}
            priceItems={priceItems.map((item) => ({
              id: item.id,
              name: item.name,
              unit: item.unit,
              price: item.price.toString(),
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
              stage: file.stage,
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
            stagesEnabled={stageConfig.enabled}
            stageExtensions={stageConfig.extensions}
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

        {showMaterials ? (
          <TabsContent value="materials" className="mt-4">
            <MaterialsSummaryTab
              groups={project.products.map((product, index) => ({
                productId: product.id,
                productNumber: product.number,
                productTitle: product.title,
                lines: materialsGroups[index]?.lines ?? [],
              }))}
            />
          </TabsContent>
        ) : null}

        {showFinance && economics ? (
          <TabsContent value="finance" className="mt-4">
            <FinanceTab
              projectId={project.id}
              currency={project.currency}
              economics={{
                expectedPrice: economics.expectedPrice,
                paidTotal: economics.paidTotal,
                expensesTotal: economics.expensesTotal,
                payrollTotal: economics.payrollTotal,
                margin: economics.margin,
                marginAtFullPrice: economics.marginAtFullPrice,
                expenseBreakdown: economics.expenseBreakdown,
              }}
              payments={project.payments.map((payment) => ({
                id: payment.id,
                direction: payment.direction,
                amount: Number(payment.amount),
                currency: payment.currency,
                rate: Number(payment.rate),
                projectAmount: Number(payment.projectAmount),
                paidAt: payment.paidAt.toISOString(),
                comment: payment.comment,
                cashAccountName: payment.cashAccount?.name ?? null,
                expenseArticleName: payment.expenseArticle?.name ?? null,
                createdByName: payment.createdById
                  ? (uploaderNames.get(payment.createdById) ?? "—")
                  : "—",
              }))}
              cashAccounts={cashAccounts.map((account) => ({
                id: account.id,
                name: account.name,
                currency: account.currency,
              }))}
              expenseArticles={expenseArticles.map((article) => ({
                id: article.id,
                name: article.name,
              }))}
            />
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
            productHistory={productHistory.map((entry) => ({
              id: entry.id,
              productNumber: entry.productNumber,
              productTitle: entry.productTitle,
              fromStatus: entry.fromStatus,
              toStatus: entry.toStatus,
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
