import {maskProductionRead,maskProductionWorkRead,maskTaskPaymentRead} from "@/server/access/production-read-projection";
import type { Prisma, ProductStatus, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { PRODUCT_STATUSES } from "@/lib/product-statuses";
import { activeListStatusValues, parseListFilterValue } from "@/lib/list-filter-values";
import { engineeringParticipantProductIds, fileVisibilityWhere, productVisibilityWhere, resolveVisibilityActor, taskVisibilityWhere, workVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";
import { taskDetailsIncludeFor,taskWorkspaceWhere } from "@/server/tasks/queries";
import { canManagePiecework, ordinaryPieceworkBinding } from "@/lib/piecework-policy";
import { productSketchProjection } from "./sketch-projection";
import { canAccessProductDraft } from "@/lib/product-drafts";
import { productDraftAccessRelations } from "@/server/access/product-draft-context";

// ── Список изделий (/products): серверные фильтры/сортировка/пагинация ──
// Состояние — в URL (?q=&status=&project=&client=&active=0&sort=&dir=&page=).

export interface ProductListFilters {
  q?: string;
  // Только канбан задаёт область; URL и другие callers её не меняют.
  searchScope?: "identity";
  status?: ProductStatus;
  projectId?: string;
  clientId?: string;
  // Инженер проекта изделия (по аналогии с фильтром «Проекты»)
  engineerId?: string;
  statuses?: ProductStatus[];
  projectIds?: string[];
  clientIds?: string[];
  engineerIds?: string[];
  // «Незавершённые» скрывает DONE; новые настройки выключены.
  activeOnly: boolean;
  sort?: ProductSortField;
  dir?: "asc" | "desc";
}

export type ProductSortField =
  | "number"
  | "title"
  | "project"
  | "client"
  | "status"
  | "price"
  | "quantity";

const PRODUCT_SORT_MAP: Record<
  ProductSortField,
  (dir: "asc" | "desc") => Prisma.ProductOrderByWithRelationInput[]
> = {
  number: (dir) => [
    { project: { numberInt: dir } },
    { suffixInt: { sort: dir, nulls: "last" } },
    { number: "asc" },
  ],
  title: (dir) => [{ title: dir }, { project: { numberInt: "desc" } }],
  project: (dir) => [{ project: { numberInt: dir } }, { suffixInt: { sort: "desc", nulls: "last" } }],
  client: (dir) => [
    { project: { client: { lastName: dir } } },
    { project: { client: { name: dir } } },
    { project: { numberInt: "desc" } },
  ],
  status: (dir) => [{ status: dir }, { project: { numberInt: "desc" } }],
  quantity: (dir) => [{ quantity: dir }, { project: { numberInt: "desc" } }],
  price: (dir) => [{ expectedPrice: dir }, { project: { numberInt: "desc" } }],
};

function productWhere(
  actor: VisibilityActor,
  filters: ProductListFilters,
  filterParticipantIds: string[],
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};
  const statuses = filters.statuses ?? (filters.status ? [filters.status] : undefined);
  const projectIds = filters.projectIds ?? (filters.projectId ? [filters.projectId] : undefined);
  const clientIds = filters.clientIds ?? (filters.clientId ? [filters.clientId] : undefined);
  const engineerIds = filters.engineerIds ?? (filters.engineerId ? [filters.engineerId] : undefined);
  if (clientIds?.length) where.project = { clientId: { in: clientIds } };
  // Инженер — на самом изделии (§10, решение владельца 09.2026)
  if (engineerIds?.length) where.OR = [
    { engineerId: { in: engineerIds } },
    { id: { in: filterParticipantIds } },
  ];
  const statusConditions: Prisma.ProductWhereInput[] = [];
  if (filters.activeOnly) {
    statusConditions.push({ status: { not: "DONE" } });
  }
  if (statuses?.length) {
    statusConditions.push({ status: { in: statuses } });
  }
  if (statusConditions.length > 0) where.AND = statusConditions;
  if (projectIds?.length) where.projectId = { in: projectIds };
  const q = filters.q?.trim();
  if (q) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: [
      { number: { contains: q } },
      { title: { contains: q, mode: "insensitive" } },
      ...(filters.searchScope === "identity" ? [] : [
        { project: { number: { contains: q } } },
        { project: { title: { contains: q, mode: "insensitive" as const } } },
        {
          project: {
            client: {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { lastName: { contains: q, mode: "insensitive" as const } },
              ],
            },
          },
        },
      ]),
    ] }];
  }
  return { AND: [productVisibilityWhere(actor), where] };
}

export async function listProducts(
  userId: string,
  roles: Role[],
  filters: ProductListFilters,
  paging?: { page: number; pageSize: number },
): Promise<{ rows: Awaited<ReturnType<typeof fetchProductRows>>; total: number }> {
  const actor = await resolveVisibilityActor(prisma, { id: userId, roles });
  const engineerIds = filters.engineerIds ?? (filters.engineerId ? [filters.engineerId] : []);
  const filterParticipantIds = [...new Set((await Promise.all([...new Set(engineerIds)].map((id) =>
    engineeringParticipantProductIds(prisma, id, false)))).flat())];
  const where = productWhere(actor, filters, filterParticipantIds);
  const sortField = filters.sort && filters.sort in PRODUCT_SORT_MAP ? filters.sort : undefined;
  const orderBy =
    sortField !== undefined
      ? PRODUCT_SORT_MAP[sortField](filters.dir ?? "desc")
      : PRODUCT_SORT_MAP.number("desc");
  if (!paging) {
    const rows = await fetchProductRows(where, orderBy, undefined, undefined, actor);
    return { rows, total: rows.length };
  }
  const [rows, total] = await Promise.all([
    fetchProductRows(
      where,
      orderBy,
      (paging.page - 1) * paging.pageSize,
      paging.pageSize,
      actor,
    ),
    prisma.product.count({ where }),
  ]);
  return { rows, total };
}

async function fetchProductRows(
  where: Prisma.ProductWhereInput,
  orderBy: Prisma.ProductOrderByWithRelationInput[],
  skip: number | undefined,
  take: number | undefined,
  actor: VisibilityActor,
) {
  const rows = await prisma.product.findMany({
    where,
    include: {
      proposalItem: productDraftAccessRelations.proposalItem,
      engineer: { select: { id: true, name: true } },
      mounter: { select: { id: true, name: true } },
      assembler: { select: { id: true, name: true } },
      files: { where: { AND:[fileVisibilityWhere(actor),{ fileName: { endsWith: ".b3d", mode: "insensitive" } }] }, select: { id: true }, take: 1 },
      sketchFile: productSketchProjection(actor),
      percentageConfigs: { where: { kind: "ENGINEERING" }, select: { participants: { where: { userId: actor.id }, select: { id: true } } } },
      project: {
        select: {
          id: true,
          deletedAt: true,
          number: true,
          title: true,
          stage: true,
          currency: true,
          client: { select: { id: true, name: true, lastName: true, middleName: true } },
        },
      },
    },
    orderBy,
    skip,
    take,
  });
  return (await maskProductionRead(prisma,actor,rows)).map((row) => ({ ...row, canAccessDraft: canAccessProductDraft(actor.roles, row), hasB3d: row.files.length > 0,
    isEngineeringParticipant: row.percentageConfigs.some((config) => config.participants.length > 0) ||
      actor.engineeringParticipantProductIds?.includes(row.id) === true }));
}

// Опции фильтров «Проект» и «Клиент»: пары, встречающиеся среди видимых
// изделий (чтобы не было пустых значений), slim — без лишних полей.
export async function listProductFilterOptions(userId: string, roles: Role[]) {
  const actor = await resolveVisibilityActor(prisma, { id: userId, roles });
  const products = await prisma.product.findMany({
    where: productVisibilityWhere(actor),
    select: {
      project: {
        select: {
          id: true,
          number: true,
          numberInt: true,
          title: true,
          client: { select: { id: true, name: true, lastName: true, middleName: true } },
        },
      },
    },
    orderBy: { project: { numberInt: "desc" } },
  });
  const projects = new Map<string, { id: string; number: string; title: string }>();
  const clients = new Map<string, { id: string; name: string; lastName: string | null; middleName: string | null }>();
  for (const product of products) {
    const { project } = product;
    if (!projects.has(project.id)) {
      projects.set(project.id, { id: project.id, number: project.number, title: project.title });
    }
    if (!clients.has(project.client.id)) {
      clients.set(project.client.id, project.client);
    }
  }
  return { projects: [...projects.values()], clients: [...clients.values()] };
}

// Парсинг searchParams раздела «Изделия» (мусор отбрасывается).
export function parseProductListParams(sp: Record<string, string | string[] | undefined>) {
  const get = (key: string) => {
    const value = sp[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const statusValues = parseListFilterValue(get("status"));
  const statuses = activeListStatusValues(statusValues, PRODUCT_STATUSES, ["RECLAMATION"]) as ProductStatus[] | undefined;
  const sortRaw = get("sort");
  const sort = (Object.keys(PRODUCT_SORT_MAP) as string[]).includes(sortRaw)
    ? (sortRaw as ProductSortField)
    : undefined;
  const dirRaw = get("dir");
  const pageSizeRaw = Number.parseInt(get("pageSize"), 10);
  return {
    filters: {
      q: get("q").slice(0, 100) || undefined,
      statuses,
      projectIds: parseListFilterValue(get("project")),
      clientIds: parseListFilterValue(get("client")),
      engineerIds: parseListFilterValue(get("engineer")),
      activeOnly: get("active") === "1",
      sort,
      dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined,
    } satisfies ProductListFilters,
    page: Math.max(1, Number.parseInt(get("page"), 10) || 1),
    pageSize: [10, 20, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 10,
  };
}

// Изделия проекта — опции для селектов (задача/работа/файл, вкладка «Задачи»)
export async function listProductOptions(projectId: string, actor: VisibilityActor) {
  actor = await resolveVisibilityActor(prisma, actor);
  return prisma.product.findMany({
    where: { AND: [{ projectId }, productVisibilityWhere(actor)] },
    select: { id: true, number: true, title: true },
    orderBy: { number: "asc" },
  });
}

export async function getProductFor(
  userId: string,
  roles: Role[],
  key: string,
) {
  const actor = await resolveVisibilityActor(prisma, { id: userId, roles });
  // Новые ссылки используют стабильный id; прежние адреса по номеру поддерживаются.
  // Найденный ID не превращаем в alias другого изделия при отказе в доступе.
  const exact = await prisma.product.findFirst({ where: { id: key }, select: { id: true } });
  const product = await prisma.product.findFirst({
    where: {
      AND: [productVisibilityWhere(actor), exact ? { id: exact.id } : { number: key }],
    },
    include: {
      proposalItem: productDraftAccessRelations.proposalItem,
      project: {
        select: {
          id: true,
          deletedAt: true,
          number: true,
          title: true,
          address: true,
          stage: true,
          currency: true,
          client: {
            select: {
              id: true,
              name: true,
              lastName: true,
              middleName: true,
              phone: true,
              address: true,
            },
          },
        },
      },
      surveyor: { select: { id: true, name: true, position: true, phone: true } },
      engineer: { select: { id: true, name: true, position: true, phone: true } },
      mounter: { select: { id: true, name: true, position: true, phone: true } },
      assembler: { select: { id: true, name: true, position: true, phone: true } },
      sketchFile: productSketchProjection(actor),
      tasks: {
        where: await taskWorkspaceWhere(actor,{productKey:key}),
        include: taskDetailsIncludeFor(actor),
        orderBy: { createdAt: "desc" },
      },
      works: {
        where: workVisibilityWhere(actor),
        include: {
          _count: { select: { paymentConversions: true, settlementShares: true } },
          tasks: { where: taskVisibilityWhere(actor), select: { id: true, title: true, status: true, quantity: true, allocationGroupId: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      files: { where: fileVisibilityWhere(actor), orderBy: { createdAt: "desc" } },
    },
  });
  if(!product)return null;
  return (await maskProductionRead(prisma,actor,[{...product,canAccessDraft:canAccessProductDraft(actor.roles,product),tasks:maskTaskPaymentRead(actor,product.tasks),works:await maskProductionWorkRead(prisma,actor,product.works.map(work => ({...work,canDistributePiecework:canManagePiecework(actor.roles)&&ordinaryPieceworkBinding(work)&&work.priceSnapshot!==null})))}]))[0];
}
