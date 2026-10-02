import { projectTotal as calculateProjectTotal } from "@/lib/product-quantity";
import type { Prisma, ProjectStage, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  ASSIGNEE_ROLES,
  MANAGER_ROLES,
} from "@/lib/roles";
import { STAGES } from "@/lib/stages";
import { taskDetailsIncludeFor } from "@/server/tasks/queries";
import { listProjectShortages } from "@/server/warehouse/queries";
import { productSketchProjection } from "@/server/products/sketch-projection";
import { clientVisibilityWhere, engineeringParticipantProductIds, fileVisibilityWhere, hasFullProjectVisibility, productVisibilityWhere, projectVisibilityWhere, resolveVisibilityActor, taskVisibilityWhere, workVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";

function scopedProjectAmounts<T extends { initialPrice: unknown; delivery: unknown; unloading: unknown; installation: unknown }>(project: T, actor: VisibilityActor) {
  return hasFullProjectVisibility(actor) ? project : {
    ...project, initialPrice: null, delivery: null, unloading: null, installation: null,
  };
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
  actor: VisibilityActor,
  filters: ProjectListFilters,
  filterParticipantIds: string[],
): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = {};
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
  // Инженер — на изделии (§10): проект «инженера X» = есть хоть одно его изделие
  if (filters.engineerId)
    where.products = { some: { AND: [productVisibilityWhere(actor), { OR: [
      { engineerId: filters.engineerId },
      { id: { in: filterParticipantIds } },
    ] }] } };
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
  return { AND: [projectVisibilityWhere(actor), where] };
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
  roles: Role[],
  filters: ProjectListFilters,
  paging?: ListPaging,
): Promise<{ rows: Awaited<ReturnType<typeof fetchProjectRows>>; total: number }> {
  const actor = await resolveVisibilityActor(prisma, { id: userId, roles });
  const filterParticipantIds = filters.engineerId ? await engineeringParticipantProductIds(prisma, filters.engineerId, false) : [];
  const where = projectWhere(actor, filters, filterParticipantIds);
  const orderBy = projectOrderBy(filters.sort, filters.dir ?? "desc");
  // Prisma's relation-count ordering cannot filter the count. Sort the visible
  // counts before pagination so hidden siblings cannot affect ordering.
  if (filters.sort === "products" && !hasFullProjectVisibility(actor)) {
    const rows = await fetchProjectRows(where, PROJECT_SORT_MAP.number("desc"), undefined, undefined, actor);
    rows.sort((a, b) => (a._count.products - b._count.products) * (filters.dir === "asc" ? 1 : -1));
    return { rows: paging ? rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize) : rows, total: rows.length };
  }
  if (!paging) {
    const rows = await fetchProjectRows(where, orderBy, undefined, undefined, actor);
    return { rows, total: rows.length };
  }
  const [rows, total] = await Promise.all([
    fetchProjectRows(
      where,
      orderBy,
      (paging.page - 1) * paging.pageSize,
      paging.pageSize,
      actor,
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
  actor: VisibilityActor,
) {
  const projects = await prisma.project.findMany({
    where,
    include: {
      client: { select: { id: true, name: true, lastName: true, middleName: true } },
      manager: { select: { id: true, name: true } },
      products: { where: productVisibilityWhere(actor), select: { id: true, expectedPrice: true, quantity: true } },
      _count: { select: {
        tasks: { where: taskVisibilityWhere(actor) },
        files: { where: fileVisibilityWhere(actor) },
        products: { where: productVisibilityWhere(actor) },
      } },
    },
    orderBy,
    skip,
    take,
  });
  // Бейдж «Нехватка материалов» на канбане/в таблице (§12) — агрегат
  // по изделиям проекта, один запрос на весь список
  const shortages = await listProjectShortages(projects.map((project) => project.id), actor);
  // Стоимость проекта = Σ цен изделий + доставка/выгрузка/монтаж (в валюте проекта)
  return projects.map((project) => ({
    ...scopedProjectAmounts(project, actor),
    totalPrice:
      calculateProjectTotal(project.products, hasFullProjectVisibility(actor) ? project : {}),
    hasMaterialShortage: shortages.has(project.id),
  }));
}

export async function getProjectFor(
  userId: string,
  roles: Role[],
  projectId: string,
  options: { includeHistory?: boolean } = {},
) {
  const actor = await resolveVisibilityActor(prisma, { id: userId, roles });
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, projectVisibilityWhere(actor)] },
    include: {
      client: true,
      manager: { select: { id: true, name: true } },
      products: {
        where: productVisibilityWhere(actor),
        include: {
          engineer: { select: { id: true, name: true } },
          files: { where: { fileName: { endsWith: ".b3d", mode: "insensitive" } }, select: { id: true }, take: 1 },
          sketchFile: productSketchProjection(actor),
          percentageConfigs: { where: { kind: "ENGINEERING" }, select: { participants: { where: { userId: actor.id }, select: { id: true } } } },
          statusHistory: options.includeHistory === false ? false : { orderBy: { createdAt: "desc" } },
        },
        // Новые изделия сверху: суффикс по числу («205.9» после «205.21»),
        // изделия без суффикса («108.») — в конце
        orderBy: [
          { suffixInt: { sort: "desc", nulls: "last" } },
          { number: "asc" },
        ],
      },
      tasks: {
        where: taskVisibilityWhere(actor),
        include: taskDetailsIncludeFor(actor),
        orderBy: { createdAt: "desc" },
      },
      works: {
        where: workVisibilityWhere(actor),
        include: {
          tasks: { where: taskVisibilityWhere(actor), select: { id: true, title: true, status: true, quantity: true, allocationGroupId: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      files: { where: fileVisibilityWhere(actor), orderBy: { createdAt: "desc" } },
      communications: options.includeHistory === false ? false : { orderBy: { happenedAt: "desc" } },
      payments: {
        where: hasFullProjectVisibility(actor) ? {} : { id: { in: [] } },
        include: {
          cashAccount: { select: { name: true } },
          expenseArticle: { select: { name: true } },
        },
        orderBy: { paidAt: "desc" },
      },
      stageHistory: options.includeHistory === false ? { where: { toStage: "DONE" }, orderBy: { createdAt: "desc" }, take: 1 } : { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) return null;
  return scopedProjectAmounts({ ...project, communications: project.communications ?? [], products: project.products.map((product) => ({
    ...product, statusHistory: product.statusHistory ?? [], hasB3d: product.files.length > 0,
    isEngineeringParticipant: product.percentageConfigs.some((config) => config.participants.length > 0) ||
      actor.engineeringParticipantProductIds?.includes(product.id) === true,
  })) }, actor);
}

export async function listClients(actor: VisibilityActor) {
  actor = await resolveVisibilityActor(prisma, actor);
  return prisma.client.findMany({
    where: clientVisibilityWhere(actor),
    include: { _count: { select: { projects: { where: projectVisibilityWhere(actor) } } } },
    orderBy: { name: "asc" },
  });
}

// Slim-вариант для фильтров/диалогов: без счётчиков, но с ФИО
// (displayClientName собирает «Фамилия Имя Отчество»).
export async function listClientOptions(actor: VisibilityActor) {
  actor = await resolveVisibilityActor(prisma, actor);
  return prisma.client.findMany({
    where: clientVisibilityWhere(actor),
    select: { id: true, name: true, lastName: true, middleName: true },
    orderBy: [{ lastName: "asc" }, { name: "asc" }],
  });
}

// Фильтры списков (§4, комбинированные роли): человек с несколькими ролями
// попадает в каждый список, где есть хоть одна его роль — менеджер+инженер
// виден и в фильтре «Менеджер», и в фильтре «Инженер».
export async function listManagers() {
  return prisma.user.findMany({
    where: { active: true, roles: { hasSome: MANAGER_ROLES } },
    select: { id: true, name: true, roles: true, position: true },
    orderBy: { name: "asc" },
  });
}

// Инженеры-проектировщики: на назначенного инженера проекта начисляется
// % от стоимости (Σ цен изделий) при переходе «В работе» (§10).
export async function listEngineers() {
  return prisma.user.findMany({
    where: { active: true, roles: { hasSome: ["ENGINEER"] } },
    select: { id: true, name: true, roles: true, position: true },
    orderBy: { name: "asc" },
  });
}

export async function listWorkers() {
  return prisma.user.findMany({
    where: { active: true, roles: { hasSome: ASSIGNEE_ROLES } },
    select: { id: true, name: true, roles: true, position: true },
    orderBy: { name: "asc" },
  });
}
