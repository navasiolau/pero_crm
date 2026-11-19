import type {Prisma} from '@prisma/client';
/** Рабочий состав исключает удалённые строки; финансовая история сохраняет их отдельно. */
export const liveProjectWhere = {deletedAt:null} satisfies Prisma.ProjectWhereInput;
export const liveProductWhere = {deletedAt:null,project:liveProjectWhere} satisfies Prisma.ProductWhereInput;
export const liveChildWhere = {project:liveProjectWhere,OR:[{productId:null},{product:liveProductWhere}]};

export const liveTaskWhere = { ...liveChildWhere, deletedAt: null } satisfies Prisma.TaskWhereInput;
export const liveWorkWhere = { ...liveChildWhere, deletedAt: null } satisfies Prisma.WorkWhereInput;
export const activeTaskDependencyWhere = { task: { deletedAt: null }, dependsOn: { deletedAt: null } } satisfies Prisma.TaskDependencyWhereInput;