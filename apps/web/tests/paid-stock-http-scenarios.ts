import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { stockPurchaseBaseline } from "./paid-stock-native-scenarios";

/** Real bot adapter/auth/quote and rejected writes; no accepted monetary HTTP posts or notifications. */
export async function runPaidStockHttp(db: PrismaClient, baseUrl: string) {
  const before=await stockPurchaseBaseline(db),tokenBefore=await db.apiToken.count(),marker=`qa103-http-${randomUUID()}`;
  const tokenIds=[randomUUID(),randomUUID()],tokens=tokenIds.map(()=>`pero_${randomBytes(24).toString("base64url")}`);
  let materialId="",cashId="",articleId="";
  try {
    for(const [index,role] of (["PROCUREMENT","MANAGER"] as const).entries())
      await db.user.create({data:{id:`${marker}-${index}`,name:marker,email:`${marker}-${index}@invalid.local`,passwordHash:"qa-login-disabled",roles:[role]}});
    materialId=(await db.material.create({data:{name:marker,purchasePrice:0}})).id;
    cashId=(await db.cashAccount.create({data:{name:marker,currency:"USD"}})).id;
    const max=await db.expenseArticle.aggregate({_max:{code:true}});
    articleId=(await db.expenseArticle.create({data:{name:marker,code:(max._max.code??0)+1}})).id;
    for(const [i,token] of tokens.entries())await db.apiToken.create({data:{id:tokenIds[i],name:marker,prefix:token.slice(0,11),tokenHash:createHash("sha256").update(token).digest("hex"),scopes:i===0?["read","write"]:["read"],createdById:`${marker}-0`}});
    const input={clientMutationId:randomUUID(),materialId,quantity:"3",unitPrice:"7.33",currency:"USD",cashAccountId:cashId,expenseArticleId:articleId,rate:3.001};
    const request=(path:string,token:string,actor:string,body:unknown=input)=>fetch(baseUrl+path,{method:"POST",redirect:"manual",headers:{authorization:`Bearer ${token}`,"x-acting-user":actor,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const create="/api/v1/bot/stock-receipts",quote=create+"/quote";
    assert.equal((await request(create,"invalid",`${marker}-0`)).status,401);
    assert.equal((await request(create,tokens[1],`${marker}-0`)).status,403);
    assert.equal((await request(create,tokens[0],`${marker}-1`)).status,403);
    const preview=await request(quote,tokens[1],`${marker}-0`);assert.equal(preview.status,200);
    const result=await preview.json();assert.equal(result.ok,true);assert.equal(result.quote.amount,21.99);assert.equal(result.quote.bynAmount,65.99);
    const directory=await fetch(baseUrl+`/api/v1/bot/directory?type=materials&q=${encodeURIComponent(marker)}`,{headers:{authorization:`Bearer ${tokens[1]}`,"x-acting-user":`${marker}-0`},signal:AbortSignal.timeout(20000)});
    assert.equal(directory.status,200);const items=(await directory.json()).items;assert.ok(items.some((item:{id:string})=>item.id===materialId));
    assert.ok(!JSON.stringify(items).includes("purchasePrice"));
    const invalid=await request(create,tokens[0],`${marker}-0`,{...input,bynAmount:1,skipReportDocument:true});
    assert.equal((await invalid.json()).ok,false);
    const changedCurrency=await request(create,tokens[0],`${marker}-0`,{...input,currency:"BYN"});
    const refusedCurrency=await changedCurrency.json();assert.equal(refusedCurrency.ok,false);assert.match(refusedCurrency.error,/валют|Касса/);
    const phase=await db.warehouseAccountingState.findUnique({where:{id:"main"},select:{phase:true}});
    const emptyCash=await request(create,tokens[0],`${marker}-0`);
    const refused=await emptyCash.json();assert.equal(refused.ok,false);
    assert.match(refused.error,phase?.phase==="ACTIVE"?/Недостаточно средств в выбранной кассе/:/Склад временно закрыт/);
    assert.equal(await db.stockMovement.count({where:{materialId}}),0);
    assert.equal(await db.stockPurchase.count({where:{actorId:`${marker}-0`}}),0);
    assert.equal(await db.payment.count({where:{cashAccountId:cashId}}),0);
    assert.equal(await db.domainEvent.count({where:{actor:`${marker}-0`}}),0);
    return {status:"PASS",quoteUSD:21.99,quoteByn:65.99,auth:"BEARER_SCOPE_ROLE",writes:"ALL_REJECTED",warehousePhase:phase?.phase??"UNINITIALIZED",providerMessages:0};
  }finally{
    await db.$transaction(async tx=>{
      await tx.apiToken.deleteMany({where:{id:{in:tokenIds},name:marker}});
      if(materialId)await tx.material.deleteMany({where:{id:materialId,name:marker}});
      if(cashId)await tx.cashAccount.deleteMany({where:{id:cashId,name:marker}});
      if(articleId)await tx.expenseArticle.deleteMany({where:{id:articleId,name:marker}});
      await tx.user.deleteMany({where:{id:{in:[`${marker}-0`,`${marker}-1`]},name:marker}});
    });
    assert.deepEqual(await stockPurchaseBaseline(db),before,"HTTP_ORIGINAL_DATA_CHANGED");
    assert.equal(await db.apiToken.count(),tokenBefore);
  }
}
