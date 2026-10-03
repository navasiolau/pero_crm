import {prisma} from "@/lib/prisma";
import type {Prisma,Role} from "@prisma/client";
import {canManageFinishCatalog,canReadFinishCatalog} from "@/lib/finish-catalog-access";
import {resolveVisibilityActor,productVisibilityWhere} from "@/server/access/visibility";
export async function lookupCatalogueAsset(actor:{id:string;roles:Role[]},assetId:string,database:Prisma.TransactionClient|typeof prisma=prisma){if(!canReadFinishCatalog(actor.roles))return null;const visibility=await resolveVisibilityActor(database,actor);return database.catalogueMediaAsset.findFirst({where:{id:assetId,deletedAt:null,OR:[{currentFinishes:{some:canManageFinishCatalog(actor.roles)?{}:{active:true}}},{assignmentSnapshots:{some:{product:productVisibilityWhere(visibility)}}}]}});}
