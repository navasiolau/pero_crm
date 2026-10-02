import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { displayClientName } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { FINANCE_ROLES, MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { canEditProductTechnicalBlock, resolveVisibilityActor } from "@/server/access/visibility";
import { allocatedWorkQuantity } from "@/lib/work-shares";
import { getFileStageConfig } from "@/server/files/stage-config";
import { getProductFor } from "@/server/products/queries";
import { deleteProductSketchAction } from "@/server/products/cover-actions";
import { listClients, listEngineers, listWorkers } from "@/server/projects/queries";
import { mapTaskDetails } from "@/server/tasks/queries";
import { getProjectMaterials, listMaterialOptions } from "@/server/warehouse/queries";

import { ProductMeasurement, ProductDocuments } from "@/components/product-attachments";
import { productAttachmentGroups } from "@/lib/product-attachment-groups";
import { MaterialsTab } from "../../projects/[id]/materials-tab";
import { TasksTab } from "../../projects/[id]/tasks-tab";
import { ProductHeader } from "./product-header";
import { ProductInlineProvider } from "@/components/product-inline-provider";
import { ProductInlineTitle, ProductInlineContacts, ProductInlineDetails } from "@/components/product-inline-fields";
import { ProductCoverClient } from "./product-sketch";
import { SinglePercentageRow } from "./product-percentage-panel";
import { getProductPercentageView } from "@/server/product-percentage-pay/queries";
import { ProductSinglePage } from "./product-overview";

export const dynamic = "force-dynamic";

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
  const canViewAllPercentage = canManage || hasAnyRole(role, FINANCE_ROLES);
  const canEditTech = canEditProductTechnicalBlock(actor, product);
  const showAmount = hasAnyRole(role, OFFICE_ROLES);
  const showMaterials = hasAnyRole(role, OFFICE_ROLES);
  const showMoney = hasAnyRole(role, ["ADMIN", "DIRECTOR"]);

  // Группировка файлов по этапам (плагин file-stages), если включён.
  const stageConfig = await getFileStageConfig();

  const [clients, workers, engineers, priceItems, materialsData, materialOptions, percentageView] =
    await Promise.all([
      canManage ? listClients(actor) : Promise.resolve([]),
      listWorkers(),
      listEngineers(),
      prisma.priceItem.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
      }),
      showMaterials ? getProjectMaterials(product.id, session.user) : Promise.resolve(null),
      showMaterials && canManage ? listMaterialOptions(session.user) : Promise.resolve([]),
      getProductPercentageView({ id: session.user.id, roles: role }, product.id),
    ]);

  const authorIds = [
    ...new Set(
      [
        ...product.files.map((file) => file.uploadedById),
      ].filter((value): value is string => !!value),
    ),
  ];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const authorNames = new Map(authors.map((user) => [user.id, user.name]));
  const fileRows = product.files.map((file) => ({
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
            }));
  const attachments = productAttachmentGroups(fileRows, product.sketchFile?.id);

  const percentagePeople = workers.map(user => ({ id: user.id, name: user.name, active: true, roles: user.roles }));
  const percentageProps = { productId: product.id, canManage, canViewAll: canViewAllPercentage };
  return (
    <ProductInlineProvider key={product.id} productId={product.id} initial={{
      title: product.title, kind: product.kind, quantity: product.quantity, expectedPrice: showAmount ? product.expectedPrice?.toString() ?? null : null, engineerId: product.engineerId, description: product.description, "project.clientId": product.project.client.id, "project.address": product.project.address, "client.phone": product.project.client.phone,
    }}>
      <ProductSinglePage
        overview={<ProductCoverClient
          productId={product.id} projectId={product.project.id}
          cover={product.sketchFile ? { id: product.sketchFile.id, fileName: product.sketchFile.fileName, mimeType: product.sketchFile.mimeType, hasThumb: product.sketchFile.hasThumb } : null}
          actorRoles={role} canEditTechnicalBlock={canEditTech}
          canDeleteCover={canEditTech && (canManage || product.files.some(file => file.id === product.sketchFile?.id && file.uploadedById === session.user.id))}
          deleteCoverAction={deleteProductSketchAction}
          header={<div className="flex min-w-0 flex-col gap-4" data-product-header="stacked">
            <div className="flex min-w-0 items-start gap-3" data-product-title-row>
              <Link href={`/projects/${product.project.id}`} className="mt-6 shrink-0 text-muted-foreground hover:text-foreground" aria-label="К проекту"><ArrowLeft className="size-5" /></Link>
              <ProductInlineTitle number={product.number} canManage={canManage} />
            </div>
            <ProductInlineContacts canManage={canManage}
              clients={(canManage ? clients : [{ id: product.project.client.id, name: displayClientName(product.project.client), phone: product.project.client.phone }]).map(client => ({value: client.id, label: "lastName" in client ? displayClientName(client) : client.name, hint: client.phone}))}
              inheritedAddress={product.project.client.address} />
          </div>}
          details={<ProductInlineDetails canManage={canManage} canEditTech={canEditTech} showAmount={showAmount} currency={product.project.currency}
            status={<div className="min-w-0 space-y-2">
              <ProductHeader product={{ id: product.id, number: product.number, title: product.title, kind: product.kind, status: product.status, expectedPrice: showAmount ? product.expectedPrice?.toString() ?? null : null, quantity: product.quantity, description: product.description, projectId: product.project.id, engineerId: product.engineerId }}
                currency={product.project.currency} canManage={canManage} showAmount={showAmount} actorRoles={role} hasB3d={percentageView.hasB3d} noModel={percentageView.noModel} isEngineeringParticipant={percentageView.sections.ENGINEERING.ownMember !== null} />
              {showMaterials && materialsData?.hasShortage ? <Badge variant="destructive"><TriangleAlert />Нехватка материалов</Badge> : null}
            </div>}
            measurement={<ProductMeasurement projectId={product.project.id} productId={product.id} files={attachments.measurement} canEdit={canEditTech} extensions={stageConfig.enabled ? stageConfig.extensions ?? undefined : undefined} />}
            engineer={<SinglePercentageRow {...percentageProps} kind="ENGINEERING" section={percentageView.sections.ENGINEERING} assignedEngineerId={product.engineerId} editEngineer candidates={engineers.map(user => ({ id: user.id, name: user.name, active: true, roles: user.roles }))} />}
          />}
        />}
        documents={<ProductDocuments projectId={product.project.id} productId={product.id} production={attachments.production} installation={attachments.installation} canEdit={canEditTech} canManage={canManage} noModel={percentageView.noModel} extensions={stageConfig.enabled ? stageConfig.extensions ?? undefined : undefined} />}
        assembly={<SinglePercentageRow {...percentageProps} kind="ASSEMBLY" section={percentageView.sections.ASSEMBLY} candidates={percentagePeople.filter(user => user.roles.includes("WORKER"))} />}
        installation={<SinglePercentageRow {...percentageProps} kind="INSTALLATION" section={percentageView.sections.INSTALLATION} candidates={percentagePeople.filter(user => user.roles.includes("MOUNTER"))} />}
        works={<TasksTab
            projectId={product.project.id}
            productId={product.id}
            productQuantity={product.quantity}
            products={[
              { id: product.id, number: product.number, title: product.title },
            ]}
            tasks={await mapTaskDetails(product.tasks, actor)}
            works={product.works.map((work) => ({
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
          />}
        materials={showMaterials && materialsData ? (<MaterialsTab
              productId={product.id}
            productQuantity={product.quantity}
              lines={materialsData.lines}
              movements={materialsData.movements}
              materialsTotalByn={materialsData.materialsTotalByn}
              options={materialOptions}
              canManage={canManage}
              showMoney={showMoney}
            />) : null}
      />
    </ProductInlineProvider>
  );
}