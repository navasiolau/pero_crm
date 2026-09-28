import type { Prisma, ProductStatus, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { PRODUCT_STATUSES } from "@/lib/product-statuses";
import { fileVisibilityWhere, productVisibilityWhere, taskVisibilityWhere, workVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";
import { taskDetailsIncludeFor } from "@/server/tasks/queries";

// ── Список изделий (/products): серверные фильтры/сортировка/пагинация ──
// Состояние — в URL (?q=&status=&project=&client=&active=0&sort=&dir=&page=).

export interface ProductListFilters {
  q?: string;
  status?: ProductStatus;
  projectId?: string;
  clientId?: string;
  // Инженер проекта изделия (по аналогии с фильтром «Проекты»)
  engineerId?: string;
  // «Только незавершённые» — по умолчанию включена (скрывает DONE)
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
  | "price";

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
  price: (dir) => [{ expectedPrice: dir }, { project: { numberInt: "desc" } }],
};

function productWhere(
  userId: string,
  roles: Role[],
  filters: ProductListFilters,
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};
  if (filters.clientId) where.project = { clientId: filters.clientId };
  // Инженер — на самом изделии (§10, решение владельца 09.2026)
  if (filters.engineerId) where.engineerId = filters.engineerId;
  const statusConditions: Prisma.ProductWhereInput[] = [];
  if (filters.activeOnly) {
    statusConditions.push({ status: { not: "DONE" } });
  }
  if (filters.status) {
    statusConditions.push({ status: filters.status });
  }
  if (statusConditions.length > 0) where.AND = statusConditions;
  if (filters.projectId) where.projectId = filters.projectId;
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { number: { contains: q } },
      { title: { contains: q, mode: "insensitive" } },
      { project: { number: { contains: q } } },
      { project: { title: { contains: q, mode: "insensitive" } } },
      {
        project: {
          client: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }
  return { AND: [productVisibilityWhere({ id: userId, roles }), where] };
}

export async function listProducts(
  userId: string,
  roles: Role[],
  filters: ProductListFilters,
  paging?: { page: number; pageSize: number },
): Promise<{ rows: Awaited<ReturnType<typeof fetchProductRows>>; total: number }> {
  const where = productWhere(userId, roles, filters);
  const sortField = filters.sort && filters.sort in PRODUCT_SORT_MAP ? filters.sort : undefined;
  const orderBy =
    sortField !== undefined
      ? PRODUCT_SORT_MAP[sortField](filters.dir ?? "desc")
      : PRODUCT_SORT_MAP.number("desc");
  if (!paging) {
    const rows = await fetchProductRows(where, orderBy, undefined, undefined);
    return { rows, total: rows.length };
  }
  const [rows, total] = await Promise.all([
    fetchProductRows(
      where,
      orderBy,
      (paging.page - 1) * paging.pageSize,
      paging.pageSize,
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
) {
  return prisma.product.findMany({
    where,
    include: {
      engineer: { select: { id: true, name: true } },
      project: {
        select: {
          id: true,
          number: true,
          title: true,
          currency: true,
          client: { select: { id: true, name: true, lastName: true, middleName: true } },
        },
      },
    },
    orderBy,
    skip,
    take,
  });
}

// Опции фильтров «Проект» и «Клиент»: пары, встречающиеся среди видимых
// изделий (чтобы не было пустых значений), slim — без лишних полей.
export async function listProductFilterOptions(userId: string, roles: Role[]) {
  const products = await prisma.product.findMany({
    where: productVisibilityWhere({ id: userId, roles }),
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
  const statusRaw = get("status");
  const status = (PRODUCT_STATUSES.some((item) => item.id === statusRaw)
    ? statusRaw
    : undefined) as ProductStatus | undefined;
  const sortRaw = get("sort");
  const sort = (Object.keys(PRODUCT_SORT_MAP) as string[]).includes(sortRaw)
    ? (sortRaw as ProductSortField)
    : undefined;
  const dirRaw = get("dir");
  const pageSizeRaw = Number.parseInt(get("pageSize"), 10);
  return {
    filters: {
      q: get("q").slice(0, 100) || undefined,
      status,
      projectId: get("project") || undefined,
      clientId: get("client") || undefined,
      engineerId: get("engineer") || undefined,
      // «Только незавершённые» включена по умолчанию (active=0 — снята)
      activeOnly: get("active") !== "0",
      sort,
      dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined,
    } satisfies ProductListFilters,
    page: Math.max(1, Number.parseInt(get("page"), 10) || 1),
    pageSize: [10, 20, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 10,
  };
}

// Изделия проекта — опции для селектов (задача/работа/файл, вкладка «Задачи»)
export async function listProductOptions(projectId: string, actor: VisibilityActor) {
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
  const actor = { id: userId, roles };
  // Адрес карточки — /products/<номер>; допускаем и внутренний id
  const product = await prisma.product.findFirst({
    where: {
      AND: [productVisibilityWhere(actor), { OR: [{ number: key }, { id: key }] }],
    },
    include: {
      project: {
        select: {
          id: true,
          number: true,
          title: true,
          address: true,
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
      sketchFile: { where: fileVisibilityWhere(actor), select: { id: true, fileName: true, mimeType: true, size: true } },
      tasks: {
        where: taskVisibilityWhere(actor),
        include: taskDetailsIncludeFor(actor),
        orderBy: { createdAt: "desc" },
      },
      works: {
        where: workVisibilityWhere(actor),
        include: {
          tasks: { where: taskVisibilityWhere(actor), select: { id: true, title: true, status: true, quantity: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      files: { where: fileVisibilityWhere(actor), orderBy: { createdAt: "desc" } },
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  return product;
}
