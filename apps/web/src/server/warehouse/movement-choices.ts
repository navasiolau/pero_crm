import type { Prisma } from "@prisma/client";
import { hasAnyRole, WAREHOUSE_MANAGE_ROLES } from "@/lib/roles";
import { liveProductWhere } from "@/server/access/live-entities";
import type { VisibilityActor } from "@/server/access/visibility";
import { getProjectMaterials } from "./queries";
import { warehouseReadPositions } from "./accounting";

export async function loadWarehouseChoices(actor:VisibilityActor, db:Prisma.TransactionClient, input:{kind:"products"|"materials"|"sources";query?:string;productId?:string;income?:boolean}) {
 if(!hasAnyRole(actor.roles,WAREHOUSE_MANAGE_ROLES))throw Error("Недостаточно прав");
 const q=input.query?.trim().slice(0,100)??"";
 if(input.kind==="products"){
  const products=await db.product.findMany({where:{...liveProductWhere,...(q?{OR:[{number:{contains:q}},{title:{contains:q,mode:"insensitive"}}]}:{})},
   select:{id:true,number:true,title:true},orderBy:{createdAt:"desc"},take:8});
  return products.map(row=>({id:row.id,label:`${row.number} · ${row.title}`}));
 }
 if(input.kind==="sources"){
  if(!input.productId)throw Error("Выберите изделие");
  const product=await db.product.findUnique({where:{...liveProductWhere,id:input.productId},select:{id:true}});
  if(!product)throw Error("Изделие не найдено");
  const data=await getProjectMaterials(product.id,actor,db);
  const choices=[...data.returnSources.map(row=>({id:row.id,label:`${row.materialName} · ${row.createdAt.slice(0,10)}`,unit:row.unit,available:row.quantity,unitPrice:row.unitPrice,legacyLineId:undefined as string|undefined})),
   ...data.lines.filter(row=>row.legacyReturnQuantity>0).map(row=>({id:"legacy:"+row.id,label:row.materialName+" · до нового учёта",unit:row.unit,available:row.legacyReturnQuantity,unitPrice:null,legacyLineId:row.id}))];
  return choices.filter(row=>!q||row.label.toLocaleLowerCase("ru-RU").includes(q.toLocaleLowerCase("ru-RU"))).slice(0,8);
 }
 const materials=await db.material.findMany({where:{...(input.income?{active:true}:{}),...(q?{OR:[{name:{contains:q,mode:"insensitive"}},{sku:{contains:q,mode:"insensitive"}}]}:{})},
  select:{id:true,name:true,measurementUnit:{select:{name:true}},active:true},orderBy:{name:"asc"}});
 const positions=await warehouseReadPositions(db,materials.map(row=>row.id));
 return materials.map(row=>({id:row.id,label:row.name+(row.active?"":" (архив)"),unit:row.measurementUnit.name,available:Number(positions.positions.get(row.id)?.quantity??0)}))
  .filter(row=>input.income||row.available>0).slice(0,8);
}
