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
import { getProductFor } from "@/server/products/queries";
import { listWorkers } from "@/server/projects/queries";
import { mapTaskDetails } from "@/server/tasks/queries";
import { getProjectMaterials, listMaterialOptions } from "@/server/warehouse/queries";

import { FilesTab } from "../../projects/[id]/files-tab";
import { MaterialsTab } from "../../projects/[id]/materials-tab";
import { TasksTab } from "../../projects/[id]/tasks-tab";
import { ProductHeader } from "./product-header";

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
  const { id } = await params;
  const role = session.user.role;

  const product = await getProductFor(session.user.id, role, id);
  if (!product) notFound();

  const canManage = ["ADMIN", "DIRECTOR", "MANAGER"].includes(role);
  const canEditTech = canManage || role === "ENGINEER";
  const showAmount = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"].includes(role);
  const showMaterials = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"].includes(role);
  const showMoney = ["ADMIN", "DIRECTOR"].includes(role);

  const [workers, priceItems, materialsData, materialOptions] = await Promise.all([
    listWorkers(),
    prisma.priceItem.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    showMaterials ? getProjectMaterials(product.id) : Promise.resolve(null),
    showMaterials && canManage ? listMaterialOptions() : Promise.resolve([]),
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
            status: product.status,
            expectedPrice: product.expectedPrice?.toString() ?? null,
            description: product.description,
            projectId: product.project.id,
          }}
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
        <span>Клиент: {displayClientName(product.project.client)}</span>
        {showAmount ? (
          <span>
            Цена: {formatAmount(product.expectedPrice?.toString() ?? null, product.project.currency)}
          </span>
        ) : null}
      </div>
      {product.description ? (
        <Card>
          <CardContent className="p-4 text-sm">
            <span className="text-muted-foreground">Технический блок: </span>
            {product.description}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="tasks">
        <TabsList>
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

        <TabsContent value="tasks" className="mt-4">
          <TasksTab
            projectId={product.project.id}
            productId={product.id}
            products={[
              { id: product.id, number: product.number, title: product.title },
            ]}
            tasks={await mapTaskDetails(product.tasks)}
            works={product.works.map((work) => ({
              id: work.id,
              title: work.title,
              quantity: work.quantity.toString(),
              allocated: work.tasks
                .reduce((sum, task) => sum + Number(task.quantity ?? 0), 0)
                .toString(),
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
