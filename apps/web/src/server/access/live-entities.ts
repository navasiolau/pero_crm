import type {Prisma} from '@prisma/client';
/** Рабочий состав исключает удалённые строки; финансовая история сохраняет их отдельно. */
export const liveProjectWhere = {deletedAt:null} satisfies Prisma.ProjectWhereInput;
export const liveProductWhere = {deletedAt:null,project:liveProjectWhere} satisfies Prisma.ProductWhereInput;
export const liveChildWhere = {project:liveProjectWhere,OR:[{productId:null},{product:liveProductWhere}]};
