import type {Prisma} from '@prisma/client';
/** Operational filters only. Financial history and number allocation retain all rows. */
export const liveProjectWhere = {deletedAt:null} satisfies Prisma.ProjectWhereInput;
export const liveProductWhere = {deletedAt:null,project:liveProjectWhere} satisfies Prisma.ProductWhereInput;
export const liveChildWhere = {project:liveProjectWhere,OR:[{productId:null},{product:liveProductWhere}]};
