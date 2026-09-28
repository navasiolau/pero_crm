import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAmount } from "@/lib/format";
import { displayClientName } from "@/lib/labels";
import { productStatusLabels } from "@/lib/product-statuses";
import { prisma } from "@/lib/prisma";
import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { canEditProductTechnicalBlock, resolveVisibilityActor } from "@/server/access/visibility";
import { allocatedWorkQuantity } from "@/lib/work-shares";
import { getFileStageConfig } from "@/server/files/stage-config";
import { getProductFor } from "@/server/products/queries";
import { listEngineers, listWorkers } from "@/server/projects/queries";
import { mapTaskDetails } from "@/server/tasks/queries";
import { getProjectMaterials, listMaterialOptions } from "@/server/warehouse/queries";

import { FilesTab } from "../../projects/[id]/files-tab";
import { MaterialsTab } from "../../projects/[id]/materials-tab";
import { TasksTab } from "../../projects/[id]/tasks-tab";
import { ProductHeader } from "./product-header";
import { ProductSketch } from "./product-sketch";
import { EngineeringFund } from "@/components/engineering-fund";
import { getEngineeringFundView } from "@/server/products/engineering-view";
import { SurveyorLink } from "./surveyor-link";

export const dynamic = "force-dynamic";

// Карточка изделия (§15): шапка (номер, название, проект, статус, цена,
// тех. блок) + вкладки «Работы и задачи», «Материалы», «Файлы», «История».
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveVisibilityActor(prisma, session.user);
  const { id } = await params;
  const role = session.user.roles;

  const product = await getProductFor(session.user.id, role, id);
  if (!product) notFound();

  const canManage = hasAnyRole(role, MANAGER_ROLES);
  const canEditTech = canEditProductTechnicalBlock(actor, product);
  const showAmount = hasAnyRole(role, OFFICE_ROLES);
  const showMaterials = hasAnyRole(role, OFFICE_ROLES);
  const showMoney = hasAnyRole(role, ["ADMIN", "DIRECTOR"]);

  // Группировка файлов по этапам (плагин file-stages), если включён.
  const stageConfig = await getFileStageConfig();

  const [workers, engineers, priceItems, materialsData, materialOptions] =
    await Promise.all([
      listWorkers(),
      listEngineers(),
      prisma.priceItem.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
      }),
      showMaterials ? getProjectMaterials(product.id, session.user) : Promise.resolve(null),
      showMaterials && canManage ? listMaterialOptions(session.user) : Promise.resolve([]),
    ]);

  const authorIds = [
    ...new Set(
      [
        ...product.files.map((file) => file.uploadedById),
        ...product.statusHistory.map((entry) => entry.changedById),
      ].filter((value): value is string => !!value),
    ),
  ];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const authorNames = new Map(authors.map((user) => [user.id, user.name]));
  const engineeringView = showAmount ? await getEngineeringFundView(prisma, product.id, canManage) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/projects/${product.project.id}`}
          className="text-muted-foreground hover:text-foreground"
          aria-label="К проекту"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold">
          {product.number} · {product.title}
        </h1>
        <ProductHeader
          product={{
            id: product.id,
            number: product.number,
            title: product.title,
            kind: product.kind,
            status: product.status,
            expectedPrice: product.expectedPrice?.toString() ?? null,
            initialPrice: product.initialPrice?.toString() ?? null,
            description: product.description,
            projectId: product.project.id,
            engineerId: product.engineerId,
          }}
          engineerOptions={engineers.map((engineer) => ({
            value: engineer.id,
            label: engineer.name,
          }))}
          currency={product.project.currency}
          canManage={canManage}
          canEditTech={canEditTech}
          showAmount={showAmount}
        />
        {showMaterials && materialsData?.hasShortage ? (
          <Badge variant="destructive">
            <TriangleAlert />
            Нехватка материалов
          </Badge>
        ) : null}
      </div>

      {/* Основные поля изделия: вид, клиент/адрес/телефон (подтягиваются
          из проекта), замерщик, статус — в шапке. */}
      <Card>
        <CardContent className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Вид изделия</div>
            <div>{product.kind ?? product.title}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Клиент</div>
            {showAmount ? (
              <Link
                href={`/clients?focus=${product.project.client.id}`}
                className="text-foreground underline-offset-2 hover:underline"
              >
                {displayClientName(product.project.client)}
              </Link>
            ) : (
              <div>{displayClientName(product.project.client)}</div>
            )}
          </div>
          <div>
            <div className="text-muted-foreground">Адрес</div>
            <div>{product.project.address ?? product.project.client.address ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Телефон</div>
            <div>{product.project.client.phone}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Замерщик</div>
            {product.surveyor ? (
              <SurveyorLink surveyor={product.surveyor} />
            ) : (
              <div>—</div>
            )}
          </div>
          <div>
            <div className="text-muted-foreground">Инженер</div>
            <div>{product.engineer?.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Статус</div>
            <div>{productStatusLabels[product.status]}</div>
          </div>
          {showAmount ? (
            <div>
              <div className="text-muted-foreground">Первоначальная цена</div>
              <div>
                {formatAmount(
                  product.initialPrice?.toString() ?? null,
                  product.project.currency,
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Тех. описание — большое, расширяется по контенту; эскиз — только
          в детальном просмотре изделия (в списке не показывается). */}
      {product.sketchFile ? (
        <ProductSketch
          sketch={{
            id: product.sketchFile.id,
            fileName: product.sketchFile.fileName,
            mimeType: product.sketchFile.mimeType,
            size: product.sketchFile.size,
          }}
        />
      ) : null}
      {product.description ? (
        <Card>
          <CardContent className="p-4 text-sm">
            <div className="mb-1 text-muted-foreground">Техническое описание</div>
            <div className="whitespace-pre-wrap">{product.description}</div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          Проект:{" "}
          <Link
            href={`/projects/${product.project.id}`}
            className="text-foreground underline-offset-2 hover:underline"
          >
            {product.project.number} · {product.project.title}
          </Link>
        </span>
        {showAmount ? (
          <span>
            Цена: {formatAmount(product.expectedPrice?.toString() ?? null, product.project.currency)}
          </span>
        ) : null}
      </div>

      <Tabs defaultValue="tasks">
        <TabsList>
          {engineeringView ? <TabsTrigger value="engineering">Инженерный фонд</TabsTrigger> : null}
          <TabsTrigger value="tasks">
            Работы и задачи ({product.tasks.length})
          </TabsTrigger>
          {showMaterials ? (
            <TabsTrigger value="materials">
              Материалы{materialsData && materialsData.lines.length > 0 ? ` (${materialsData.lines.length})` : ""}
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="files">Файлы ({product.files.length})</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>

        {engineeringView ? <TabsContent value="engineering" className="mt-4">
          <EngineeringFund view={engineeringView} canManage={canManage} workers={workers.map((worker) => ({ id: worker.id, name: worker.name }))} />
        </TabsContent> : null}
        <TabsContent value="tasks" className="mt-4">
          <TasksTab
            projectId={product.project.id}
            productId={product.id}
            products={[
              { id: product.id, number: product.number, title: product.title },
            ]}
            tasks={await mapTaskDetails(product.tasks, actor)}
            works={product.works.map((work) => ({
              id: work.id,
              title: work.title,
              quantity: work.quantity.toString(),
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

        {showMaterials && materialsData ? (
          <TabsContent value="materials" className="mt-4">
            <MaterialsTab
              productId={product.id}
              lines={materialsData.lines}
              movements={materialsData.movements}
              materialsTotalByn={materialsData.materialsTotalByn}
              options={materialOptions}
              canManage={canManage}
              showMoney={showMoney}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="files" className="mt-4">
          <FilesTab
            projectId={product.project.id}
            productId={product.id}
            files={product.files.map((file) => ({
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
                ? (authorNames.get(file.uploadedById) ?? "—")
                : "—",
            }))}
            canEdit={canEditTech}
            stagesEnabled={stageConfig.enabled}
            stageExtensions={stageConfig.extensions}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">История статусов</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {product.statusHistory.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
                  <div className="text-sm">
                    {entry.fromStatus ? (
                      <>
                        {productStatusLabels[entry.fromStatus]} →{" "}
                        <Badge variant="secondary">
                          {productStatusLabels[entry.toStatus]}
                        </Badge>
                      </>
                    ) : (
                      <>
                        Создано:{" "}
                        <Badge variant="secondary">
                          {productStatusLabels[entry.toStatus]}
                        </Badge>
                      </>
                    )}
                  </div>
                  {entry.comment ? (
                    <div className="text-sm text-muted-foreground">{entry.comment}</div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    {entry.changedById
                      ? (authorNames.get(entry.changedById) ?? "—")
                      : "—"}{" "}
                    · {new Date(entry.createdAt).toLocaleString("ru-RU")}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
