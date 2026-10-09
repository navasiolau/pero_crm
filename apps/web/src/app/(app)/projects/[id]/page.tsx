import { paymentView } from "@/server/finance/payment-view";
import { loadProjectStockExpenses, projectExpenseRows } from "@/server/finance/project-expenses";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ComponentType } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { resolveProjectTab } from "@/lib/product-return-navigation";
import { ProjectTabs } from "@/components/project-tabs";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SlotErrorBoundary } from "@/components/plugins/slot-error-boundary";
import { displayClientName } from "@/lib/labels";
import {
  FINANCE_ROLES,
  MANAGER_ROLES,
  OFFICE_ROLES,
  hasAnyRole,
  hasRole,
} from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { getPluginSettings } from "@/server/plugins/run-log";
import { getSlotContributions } from "@/server/plugins/slots";
import { getProjectPricingProjection } from "@/server/projects/project-field-core";
import { getProjectEconomics } from "@/server/finance/queries";
import { getProjectFor, listClients, listEngineers, listManagers, listWorkers } from "@/server/projects/queries";
import { mapTaskDetails } from "@/server/tasks/queries";
import { getProjectMaterials } from "@/server/warehouse/queries";
import { hasFullProjectVisibility } from "@/server/access/visibility";
import {canViewProductMoney} from "@/lib/product-financial-access";
import { allocatedWorkQuantity } from "@/lib/work-shares";

import { FilesTab } from "./files-tab";
import { FinanceTab } from "./finance-tab";
import { MaterialsSummaryTab } from "./materials-summary-tab";
import { ProjectInlineProvider } from "@/components/project-inline-provider";
import {ProjectDeleteButton} from '@/components/project-delete-button';
import { ProjectInlineHeading } from "@/components/project-inline-fields";
import { OverviewTab } from "./overview-tab";
import { ProductsTab } from "./products-tab";
import { TasksTab } from "./tasks-tab";

export const dynamic = "force-dynamic";

// Карточка проекта = заказ клиента (§15): «Общее», «Изделия», «Задачи»,
// «Файлы», «Коммуникации», «Финансы» (админ/директор/бухгалтер),
// «Материалы» (сводно по изделиям, только просмотр), «История»
// + вкладки плагинов (слот project.tab).
export default async function ProjectPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const role = session.user.roles;

  const project = await getProjectFor(session.user.id, role, id, { includeHistory: false });
  if (!project) notFound();

  const canManage = hasAnyRole(role, MANAGER_ROLES);
  const canEditTech = canManage || hasRole(role, "ENGINEER");
  const showFinance = hasAnyRole(role, FINANCE_ROLES);
  const showAmount = canViewProductMoney(role);
  // Склад (§12): вкладка «Материалы» — офисные роли (+ бухгалтер на просмотр)
  const showMaterials = hasAnyRole(role, OFFICE_ROLES);

  const stockExpenses = showFinance ? await loadProjectStockExpenses(session.user, project.id, prisma) : [];

  const [clients, managers, engineers, workers, contributions, priceItems, economics, cashAccounts, expenseArticles, materialsGroups] =
    await Promise.all([
      listClients(session.user),
      listManagers(),
      listEngineers(),
      listWorkers(),
      hasFullProjectVisibility(session.user) ? getSlotContributions("project.tab") : Promise.resolve([]),
      prisma.priceItem.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
      }),
      // Данные вкладки «Финансы» (§11) — админу/директору/бухгалтеру
      showFinance ? getProjectEconomics(project.id, prisma, { payments: project.payments, stockMovements: stockExpenses }) : Promise.resolve(null),
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
        ...project.payments.map((p) => p.createdById),
        ...stockExpenses.map(row => row.createdById),
        ...project.tasks.flatMap((t) => [t.createdById, t.doneById]),
      ].filter((v): v is string => !!v),
    ),
  ];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const uploaderNames = new Map(authors.map((user) => [user.id, user.name]));

  const showOverviewAmount = canViewProductMoney(role);
  const pricingProjection = showOverviewAmount ? await getProjectPricingProjection({id:session.user.id,name:session.user.name??"",roles:role,source:"web"},project.id) : null;
  const hasShortage = materialsGroups.some(group => group.hasShortage);

  const initialTab = resolveProjectTab((await searchParams).tab, ["overview", "products", "files", "tasks", ...(showMaterials ? ["materials"] : []), ...(showFinance ? ["finance"] : []), ...pluginTabs.map(tab => tab.pluginId)]);

  return (
    <ProjectInlineProvider key={project.id} projectId={project.id} stage={project.stage} pricingProjection={pricingProjection} initial={{
      title: project.title, clientId: project.clientId, managerId: project.managerId,
      'client.phone':project.client.phone,'client.address':project.client.address,
      delivery: showOverviewAmount ? pricingProjection ? pricingProjection.delivery : project.delivery?.toString() ?? null : null, unloading: showOverviewAmount ? pricingProjection ? pricingProjection.unloading : project.unloading?.toString() ?? null : null, installation: showOverviewAmount ? pricingProjection ? pricingProjection.installation : project.installation?.toString() ?? null : null,
    }}>
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground"
          aria-label="К списку проектов"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <ProjectInlineHeading number={project.number} />
        <div className="ml-auto"><ProjectDeleteButton projectId={project.id} canManage={canManage}/></div>
        {showMaterials && hasShortage ? (
          <Badge variant="destructive">
            <TriangleAlert />
            Нехватка материалов
          </Badge>
        ) : null}
      </div>

      <ProjectTabs initialTab={initialTab}>
        <TabsList className="w-full max-w-full justify-start overflow-x-auto">
          <TabsTrigger className="shrink-0" value="overview">Общее</TabsTrigger>
          <TabsTrigger className="shrink-0" value="products">
            Изделия ({project.products.length})
          </TabsTrigger>
          <TabsTrigger className="shrink-0" value="files">Файлы ({project.files.length})</TabsTrigger>
          <TabsTrigger className="shrink-0" value="tasks">Задачи ({project.tasks.length})</TabsTrigger>
          {showMaterials ? <TabsTrigger className="shrink-0" value="materials">Материалы</TabsTrigger> : null}
          {showFinance ? <TabsTrigger className="shrink-0" value="finance">Финансы</TabsTrigger> : null}
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
              coverFile: project.coverFile,
              number: project.number,
              stage: project.stage,
              stageChangedAt: project.stageChangedAt,
              currency: project.currency,
              createdAt: project.createdAt,
              refusalReason: project.refusalReason,
              refusalComment: project.refusalComment,
              reclamationReason: project.reclamationReason,
              reclamationDescription: project.reclamationDescription,
              reclamationFault: project.reclamationFault,
            }}
            doneAt={project.stageHistory[0]?.createdAt.toISOString() ?? null}
            createdByName={
              project.createdById
                ? (uploaderNames.get(project.createdById) ?? null)
                : null
            }
            canManage={canManage}
            showAmount={showOverviewAmount}
            clients={[...clients, ...(clients.some(client=>client.id===project.client.id)?[]:[project.client])].map((client) => ({ id: client.id, label: displayClientName(client), phone:client.phone, address:client.address }))}
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
            projectStage={project.stage}
            currency={project.currency}
            initialProducts={project.products.map((product) => ({
              id: product.id,
              number: product.number,
              title: product.title,
              status: product.status,
              statusChangedAt: product.statusChangedAt.toISOString(),
              expectedPrice: product.expectedPrice?.toString() ?? null,
              quantity: product.quantity,
              engineerName: product.engineer?.name ?? null,
              engineerId: product.engineerId,
              isEngineeringParticipant: product.isEngineeringParticipant,
              hasB3d: product.hasB3d,
              noModel: product.noModel,
              sketchFile: product.sketchFile,
            }))}
            canManage={canManage}
            actorRoles={role}
            actorUserId={session.user.id}
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
              quantityPerUnit: work.quantityPerUnit?.toString() ?? null,
              allocated: allocatedWorkQuantity(work.tasks),
              priceSnapshot: work.priceSnapshot?.toString() ?? null,
              total: work.total?.toString() ?? null,
              paymentKind: work.paymentKind,
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
            files={project.files.filter(file => file.id !== project.coverFileId).map((file) => ({
              id: file.id,
              fileName: file.fileName,
              section: file.section,
              mimeType: file.mimeType,
              size: file.size,
              hasThumb: file.hasThumb,
              createdAt: file.createdAt.toISOString(),
              uploaderName: file.uploadedById
                ? (uploaderNames.get(file.uploadedById) ?? "—")
                : "—",
            }))}
            canEdit={canEditTech}
            flatProject
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
              payments={project.payments.map(payment => paymentView(payment, uploaderNames))}
              expenseRows={projectExpenseRows(project.payments, stockExpenses, uploaderNames)}
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

        {pluginTabs.map((tab) => (
          <TabsContent key={tab.pluginId} value={tab.pluginId} className="mt-4">
            <SlotErrorBoundary pluginName={tab.pluginName}>
              <tab.Component projectId={project.id} settings={tab.settings} />
            </SlotErrorBoundary>
          </TabsContent>
        ))}
      </ProjectTabs>
    </div>
    </ProjectInlineProvider>
  );
}
