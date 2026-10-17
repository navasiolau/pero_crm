import {maskProductionRead,maskProductionWorkRead,maskTaskPaymentRead} from "@/server/access/production-read-projection";
import {activePaymentWhere} from '@/server/payments/active-records';
import { canViewProductDrafts } from "@/lib/product-drafts";
import { liveProductWhere } from "@/server/access/live-entities";
import {canViewProductMoney} from "@/lib/product-financial-access";
import { projectTotal as calculateProjectTotal } from "@/lib/product-quantity";
import type { Prisma, ProjectStage, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { publicClientSelect } from "@/server/clients/projection";
import { reportDocumentSelect } from "@/server/finance-documents/view";
import { logisticsAllocationSelect } from "@/server/logistics/payment-view";
import {
  ASSIGNEE_ROLES,
  MANAGER_ROLES,
  FINANCE_ROLES,
  hasAnyRole,
} from "@/lib/roles";
import { STAGES } from "@/lib/stages";
import { parseListFilterValue } from "@/lib/list-filter-values";
import { taskDetailsIncludeFor,taskWorkspaceWhere } from "@/server/tasks/queries";
import { listProjectShortages } from "@/server/warehouse/queries";
import { productSketchProjection } from "@/server/products/sketch-projection";
import { projectCoverProjection } from "./cover-projection";
import { clientVisibilityWhere, engineeringParticipantProductIds, fileVisibilityWhere, hasFullProjectVisibility, productVisibilityWhere, projectVisibilityWhere, resolveVisibilityActor, taskVisibilityWhere, workVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";

function scopedProjectAmounts<T extends { initialPrice: unknown; delivery: unknown; unloading: unknown; installation: unknown }>(project: T, actor: VisibilityActor) {
  return canViewProductMoney(actor.roles) ? project : {
    ...project, initialPrice: null, delivery: null, unloading: null, installation: null,
  };
}

// ── Список проектов: серверные фильтры/сортировка/пагинация ─────────────
// Состояние живёт в URL (?q=&stage=&client=&…&active=0&sort=&dir=&page=),
// парсинг — на сервере, мусор отбрасывается.

export interface ProjectListFilters {
  q?: string;
  // Только канбан задаёт область; URL и другие callers её не меняют.
  searchScope?: "identity";
  stage?: ProjectStage;
  clientId?: string;
  managerId?: string;
  engineerId?: string;
  stages?: ProjectStage[];
  clientIds?: string[];
  managerIds?: string[];
  engineerIds?: string[];
  // «Незавершённые» скрывает DONE и REFUSED; новые настройки выключены.
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
  // Пустой plural-набор снимает фильтр; scalar-поля поддерживают старые callers.
  const stages = filters.stages ?? (filters.stage ? [filters.stage] : undefined);
  const clientIds = filters.clientIds ?? (filters.clientId ? [filters.clientId] : undefined);
  const managerIds = filters.managerIds ?? (filters.managerId ? [filters.managerId] : undefined);
  const engineerIds = filters.engineerIds ?? (filters.engineerId ? [filters.engineerId] : undefined);
  // Незавершённые и явно выбранные этапы сочетаются через AND.
  const stageConditions: Prisma.ProjectWhereInput[] = [];
  if (filters.activeOnly) {
    stageConditions.push({ stage: { notIn: ["DONE", "REFUSED"] } });
  }
  if (stages?.length) {
    stageConditions.push({ stage: { in: stages } });
  }
  if (stageConditions.length > 0) where.AND = stageConditions;
  if (clientIds?.length) where.clientId = { in: clientIds };
  if (managerIds?.length) where.managerId = { in: managerIds };
  // Инженер — на изделии (§10): проект «инженера X» = есть хоть одно его изделие
  if (engineerIds?.length)
    where.products = { some: { AND: [productVisibilityWhere(actor), { OR: [
      { engineerId: { in: engineerIds } },
      { id: { in: filterParticipantIds } },
    ] }] } };
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { number: { contains: q } },
      { title: { contains: q, mode: "insensitive" } },
      ...(filters.searchScope === "identity" ? [] : [{
        client: {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { middleName: { contains: q, mode: "insensitive" as const } },
          ],
        },
      }]),
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
  const stageValues = parseListFilterValue(get("stage"));
  // Невалидный этап игнорируется; область доступа ниже остаётся обязательной.
  const stages = stageValues === undefined ? undefined : stageValues.every((value) => STAGES.some((item) => item.id === value))
    ? stageValues as ProjectStage[] : undefined;
  const sortRaw = get("sort");
  const sort = (Object.keys(PROJECT_SORT_MAP) as string[]).includes(sortRaw)
    ? (sortRaw as ProjectSortField)
    : undefined;
  const dirRaw = get("dir");
  const pageSizeRaw = Number.parseInt(get("pageSize"), 10);
  return {
    filters: {
      q: get("q").slice(0, 100) || undefined,
      stages,
      clientIds: parseListFilterValue(get("client")),
      managerIds: parseListFilterValue(get("manager")),
      engineerIds: parseListFilterValue(get("engineer")),
      activeOnly: get("active") === "1",
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
): Promise<{ rows: Awaited<ReturnType<typeof addProjectTaskCounts>>; total: number }> {
  const actor = await resolveVisibilityActor(prisma, { id: userId, roles });
  const engineerIds = filters.engineerIds ?? (filters.engineerId ? [filters.engineerId] : []);
  const filterParticipantIds = [...new Set((await Promise.all([...new Set(engineerIds)].map((id) =>
    engineeringParticipantProductIds(prisma, id, false)))).flat())];
  const where = projectWhere(actor, filters, filterParticipantIds);
  const orderBy = projectOrderBy(filters.sort, filters.dir ?? "desc");
  // Prisma's relation-count ordering cannot filter the count. Sort the visible
  // counts before pagination so hidden siblings cannot affect ordering.
  if (filters.sort === "products" && !canViewProductDrafts(actor.roles)) {
    const rows = await fetchProjectRows(where, PROJECT_SORT_MAP.number("desc"), undefined, undefined, actor);
    rows.sort((a, b) => (a._count.products - b._count.products) * (filters.dir === "asc" ? 1 : -1));
    const selected=paging ? rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize) : rows;
    return { rows:await addProjectTaskCounts(selected,actor), total:rows.length };
  }
  if (!paging) {
    const rows = await fetchProjectRows(where, orderBy, undefined, undefined, actor);
    return { rows:await addProjectTaskCounts(rows,actor), total:rows.length };
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
  return { rows:await addProjectTaskCounts(rows,actor), total };
}

// Счётчики задач добавляются после окончательной сортировки и выбора страницы.
async function addProjectTaskCounts(rows:Awaited<ReturnType<typeof fetchProjectRows>>,actor:VisibilityActor){
  const counts=rows.length?await prisma.task.groupBy({
    by:['projectId'],where:await taskWorkspaceWhere(actor,{projectIds:rows.map(row=>row.id)}),_count:{_all:true},
  }):[];
  const byProject=new Map(counts.map(row=>[row.projectId,row._count._all]));
  return rows.map(row=>({...row,_count:{...row._count,tasks:byProject.get(row.id)??0}}));
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
      coverFile: projectCoverProjection(actor),
      stageHistory: { orderBy: { createdAt: "desc" }, take: 1, select: { toStage: true, createdAt: true } },
      products: { where: productVisibilityWhere(actor), select: { id: true, expectedPrice: true, quantity: true } },
      _count: { select: {
        files: { where: fileVisibilityWhere(actor) },
        products: { where: productVisibilityWhere(actor) },
      } },
    },
    orderBy,
    skip,
    take,
  });
  // Денежная область менеджмента сохраняется: скрытие черновых карточек
  // не меняет стоимость заказа. В DTO отправляется только итог, не скрытые строки.
  const financialProducts = hasFullProjectVisibility(actor) && canViewProductMoney(actor.roles) && !canViewProductDrafts(actor.roles)
    ? await prisma.product.findMany({
      where: { ...liveProductWhere, projectId: { in: projects.map(project => project.id) } },
      select: { projectId: true, expectedPrice: true, quantity: true },
    }) : [];
  const amountsByProject = new Map<string, typeof financialProducts>();
  for (const product of financialProducts) {
    const rows = amountsByProject.get(product.projectId) ?? [];
    rows.push(product);
    amountsByProject.set(product.projectId, rows);
  }
  // Бейдж «Нехватка материалов» на канбане/в таблице (§12) — агрегат
  // по изделиям проекта, один запрос на весь список
  const shortages = await listProjectShortages(projects.map((project) => project.id), actor);
  // Стоимость проекта = Σ цен изделий + доставка/выгрузка/монтаж (в валюте проекта)
  return projects.map((project) => ({
    ...scopedProjectAmounts(project, actor),
    products:canViewProductMoney(actor.roles)?project.products:project.products.map(product=>({...product,expectedPrice:null})),
    totalPrice:
      canViewProductMoney(actor.roles)?calculateProjectTotal(amountsByProject.get(project.id) ?? project.products, project):null,
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
      coverFile: projectCoverProjection(actor),
      client: { select: publicClientSelect },
      manager: { select: { id: true, name: true } },
      products: {
        where: productVisibilityWhere(actor),
        include: {
          engineer: { select: { id: true, name: true } },
          files: { where: { AND:[fileVisibilityWhere(actor),{ fileName: { endsWith: ".b3d", mode: "insensitive" } }] }, select: { id: true }, take: 1 },
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
        where: await taskWorkspaceWhere(actor,{projectId}),
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
        where: hasAnyRole(actor.roles,FINANCE_ROLES) ? activePaymentWhere : { id: { in: [] } },
        include: {
          cashAccount: { select: { name: true } },
          expenseArticle: { select: { id: true, name: true } },
          reportDocument: { select: reportDocumentSelect },
          logisticsAllocation: { select: logisticsAllocationSelect },
        },
        orderBy: { paidAt: "desc" },
      },
      stageHistory: options.includeHistory === false ? { where: { toStage: "DONE" }, orderBy: { createdAt: "desc" }, take: 1 } : { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) return null;
  return scopedProjectAmounts({ ...project,tasks:maskTaskPaymentRead(actor,project.tasks), works:await maskProductionWorkRead(prisma,actor,project.works),communications: project.communications ?? [], products: (await maskProductionRead(prisma,actor,project.products)).map((product) => ({
    ...product, statusHistory: product.statusHistory ?? [], hasB3d: product.files.length > 0,
    isEngineeringParticipant: product.percentageConfigs.some((config) => config.participants.length > 0) ||
      actor.engineeringParticipantProductIds?.includes(product.id) === true,
  })) }, actor);
}

export async function listClients(actor: VisibilityActor) {
  actor = await resolveVisibilityActor(prisma, actor);
  return prisma.client.findMany({
    where: clientVisibilityWhere(actor),
    select: { ...publicClientSelect, _count: { select: { projects: { where: projectVisibilityWhere(actor) } } } },
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
