import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasAnyRole, WAREHOUSE_MANAGE_ROLES } from "@/lib/roles";
import { authenticate, isErrorResponse } from "@/server/api/auth";
import { resolveBotActor, isActorError, domainError } from "@/server/telegram/bot-api";
import { createStockMovementCore } from "@/server/warehouse/movement-service";
import { loadWarehouseChoices } from "@/server/warehouse/movement-choices";
async function actorFor(request:Request,scope:"read"|"write"){
 const auth=await authenticate(request,scope);if(isErrorResponse(auth))return auth;
 const actor=await resolveBotActor(request);if(isActorError(actor))return actor;
 if(!hasAnyRole(actor.roles,WAREHOUSE_MANAGE_ROLES))return NextResponse.json({ok:false,error:"Недостаточно прав"},{status:403});
 return actor;
}
export async function GET(request:Request){
 const actor=await actorFor(request,"read");if(actor instanceof Response)return actor;
 const params=new URL(request.url).searchParams,kind=params.get("kind");
 if(kind!=="products"&&kind!=="materials"&&kind!=="sources")return NextResponse.json({ok:false,error:"Неизвестный справочник"},{status:400});
 try{return NextResponse.json({ok:true,items:await loadWarehouseChoices(actor,prisma,{kind,query:params.get("q")??"",productId:params.get("productId")??undefined,income:params.get("income")==="1"})});}
 catch(error){return domainError(error);}
}
export async function POST(request:Request){
 const actor=await actorFor(request,"write");if(actor instanceof Response)return actor;
 const body=await request.json().catch(()=>null);
 if(!body||!["INCOME","EXPENSE","RETURN"].includes(body.kind))return NextResponse.json({ok:false,error:"Неизвестная складская операция"},{status:400});
 const {kind,...input}=body;
 try{return NextResponse.json(await createStockMovementCore(actor,kind,input));}
 catch(error){return domainError(error);}
}
