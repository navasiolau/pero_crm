import type { Prisma, ProjectStage, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { STAGES } from "@/lib/stages";
import { taskDetailsInclude } from "@/server/tasks/queries";
import { listProjectShortages } from "@/server/warehouse/queries";

// Правила видимости (§4): офисные роли — все проекты;
// работник/монтажник — только проекты со своими задачами.
export const OFFICE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"];
export const MANAGER_ROLES: Role[] = ["ADMIN", "DIRECTOR", "MANAGER"];

function projectVisibilityFilter(userId: string, role: Role) {
  if (OFFICE_ROLES.includes(role)) return {};
  return { tasks: { some: { assigneeId: userId } } };
}

// ── Список проектов: серверные фильтры/сортировка/пагинация ─────────────
// Состояние живёт в URL (?q=&stage=&client=&…&active=0&sort=&dir=&page=),
// парсинг — на сервере, мусор отбрасывается.

export interface ProjectListFilters {
  q?: string;
  stage?: ProjectStage;
  clientId?: string;
  managerId?: string;
  engineerId?: string;
  // «Только незавершённые» — по умолчанию включена (скрывает DONE и REFUSED)
  activeOnly: boolean;
  sort?: ProjectSortField;
  dir?: "asc" | "desc";
}

export type ProjectSortField =
  | "number"
  | "title"
  | "client"
  | "stage"
  | "manager"
  | "products";

export interface ListPaging {
  page: number; // 1-based
  pageSize: number;
}

const PROJECT_SORT_MAP: Record<
  ProjectSortField,
  (dir: "asc" | "desc") => Prisma.ProjectOrderByWithRelationInput[]
> = {
  number: (dir) => [{ numberInt: dir }],
  title: (dir) => [{ title: dir }, { numberInt: "desc" }],
  client: (dir) => [
    { client: { lastName: dir } },
    { client: { name: dir } },
    { numberInt: "desc" },
  ],
  stage: (dir) => [{ stage: dir }, { numberInt: "desc" }],
  manager: (dir) => [{ manager: { name: dir } }, { numberInt: "desc" }],
  products: (dir) => [{ products: { _count: dir } }, { numberInt: "desc" }],
};

function projectWhere(
  userId: string,
  role: Role,
  filters: ProjectListFilters,
): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = {
    ...projectVisibilityFilter(userId, role),
  };
  // Этап: галочка «Только незавершённые» (скрывает DONE и REFUSED — решение
  // владельца, 08.2026) и явный фильтр по этапу сочетаются через AND
  const stageConditions: Prisma.ProjectWhereInput[] = [];
  if (filters.activeOnly) {
    stageConditions.push({ stage: { notIn: ["DONE", "REFUSED"] } });
  }
  if (filters.stage) {
    stageConditions.push({ stage: filters.stage });
  }
  if (stageConditions.length > 0) where.AND = stageConditions;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.managerId) where.managerId = filters.managerId;
  if (filters.engineerId) where.engineerId = filters.engineerId;
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { number: { contains: q } },
      { title: { contains: q, mode: "insensitive" } },
      {
        client: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { middleName: { contains: q, mode: "insensitive" } },
          ],
        },
      },
    ];
  }
  return where;
}

function projectOrderBy(
  filters: ProjectSortField | undefined,
  dir: "asc" | "desc",
): Prisma.ProjectOrderByWithRelationInput[] {
  // Дефолт — «новые сверху»: каноничные номера после миграции нормализации
  return filters && filters in PROJECT_SORT_MAP
    ? PROJECT_SORT_MAP[filters](dir)
    : PROJECT_SORT_MAP.number("desc");
}

// Парсинг searchParams раздела «Проекты» (Next 15 отдаёт их promise'ом;
// значения-массивы схлопываются к первому, мусор отбрасывается).
export function parseProjectListParams(sp: Record<string, string | string[] | undefined>) {
  const get = (key: string) => {
    const value = sp[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const stageRaw = get("stage");
  const stage = (STAGES.some((item) => item.id === stageRaw)
    ? stageRaw
    : undefined) as ProjectStage | undefined;
  const sortRaw = get("sort");
  const sort = (Object.keys(PROJECT_SORT_MAP) as string[]).includes(sortRaw)
    ? (sortRaw as ProjectSortField)
    : undefined;
  const dirRaw = get("dir");
  const pageSizeRaw = Number.parseInt(get("pageSize"), 10);
  return {
    filters: {
      q: get("q").slice(0, 100) || undefined,
      stage,
      clientId: get("client") || undefined,
      managerId: get("manager") || undefined,
      engineerId: get("engineer") || undefined,
      // Галочка «Только незавершённые» включена по умолчанию (active=0 — снята)
      activeOnly: get("active") !== "0",
      sort,
      dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : undefined,
    } satisfies ProjectListFilters,
    page: Math.max(1, Number.parseInt(get("page"), 10) || 1),
    pageSize: [10, 20, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 10,
  };
}

export async function listProjects(
  userId: string,
  role: Role,
  filters: ProjectListFilters,
  paging?: ListPaging,
): Promise<{ rows: Awaited<ReturnType<typeof fetchProjectRows>>; total: number }> {
  const where = projectWhere(userId, role, filters);
  const orderBy = projectOrderBy(filters.sort, filters.dir ?? "desc");
  if (!paging) {
    const rows = await fetchProjectRows(where, orderBy, undefined, undefined);
    return { rows, total: rows.length };
  }
  const [rows, total] = await Promise.all([
    fetchProjectRows(
      where,
      orderBy,
      (paging.page - 1) * paging.pageSize,
      paging.pageSize,
    ),
    prisma.project.count({ where }),
  ]);
  return { rows, total };
}

async function fetchProjectRows(
  where: Prisma.ProjectWhereInput,
  orderBy: Prisma.ProjectOrderByWithRelationInput[],
  skip: number | undefined,
  take: number | undefined,
) {
  const projects = await prisma.project.findMany({
    where,
    include: {
      client: { select: { id: true, name: true, lastName: true, middleName: true } },
      manager: { select: { id: true, name: true } },
      products: { select: { id: true, expectedPrice: true } },
      _count: { select: { tasks: true, files: true, products: true } },
    },
    orderBy,
    skip,
    take,
  });
  // Бейдж «Нехватка материалов» на канбане/в таблице (§12) — агрегат
  // по изделиям проекта, один запрос на весь список
  const shortages = await listProjectShortages(projects.map((project) => project.id));
  return projects.map((project) => ({
    ...project,
    // Стоимость проекта = Σ цен изделий (в валюте проекта)
    totalPrice: project.products.reduce(
      (sum, product) => sum + Number(product.expectedPrice ?? 0),
      0,
    ),
    hasMaterialShortage: shortages.has(project.id),
  }));
}

export async function getProjectFor(
  userId: string,
  role: Role,
  projectId: string,
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...projectVisibilityFilter(userId, role) },
    include: {
      client: true,
      manager: { select: { id: true, name: true } },
      engineer: { select: { id: true, name: true } },
      products: {
        include: {
          statusHistory: { orderBy: { createdAt: "desc" } },
        },
        // Новые изделия сверху: суффикс по числу («205.9» после «205.21»),
        // изделия без суффикса («108.») — в конце
        orderBy: [
          { suffixInt: { sort: "desc", nulls: "last" } },
          { number: "asc" },
        ],
      },
      tasks: {
        include: taskDetailsInclude,
        orderBy: { createdAt: "desc" },
      },
      works: {
        include: {
          tasks: { select: { id: true, title: true, status: true, quantity: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      files: { orderBy: { createdAt: "desc" } },
      communications: { orderBy: { happenedAt: "desc" } },
      payments: {
        include: {
          cashAccount: { select: { name: true } },
          expenseArticle: { select: { name: true } },
        },
        orderBy: { paidAt: "desc" },
      },
      stageHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  return project;
}

export async function listClients() {
  return prisma.client.findMany({
    include: { _count: { select: { projects: true } } },
    orderBy: { name: "asc" },
  });
}

// Slim-вариант для фильтров/диалогов: без счётчиков, но с ФИО
// (displayClientName собирает «Фамилия Имя Отчество»).
export async function listClientOptions() {
  return prisma.client.findMany({
    select: { id: true, name: true, lastName: true, middleName: true },
    orderBy: [{ lastName: "asc" }, { name: "asc" }],
  });
}

export async function listManagers() {
  return prisma.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "DIRECTOR", "MANAGER"] } },
    select: { id: true, name: true, role: true, position: true },
    orderBy: { name: "asc" },
  });
}

// Инженеры-проектировщики: на назначенного инженера проекта начисляется
// % от стоимости (Σ цен изделий) при переходе «В работе» (§10).
export async function listEngineers() {
  return prisma.user.findMany({
    where: { active: true, role: "ENGINEER" },
    select: { id: true, name: true, role: true, position: true },
    orderBy: { name: "asc" },
  });
}

export async function listWorkers() {
  return prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["WORKER", "MOUNTER", "ENGINEER", "MANAGER"] },
    },
    select: { id: true, name: true, role: true, position: true },
    orderBy: { name: "asc" },
  });
}
