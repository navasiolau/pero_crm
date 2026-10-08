import type {Prisma,PrismaClient} from "@prisma/client";
export const statementQuery={from:"2026-10-07",to:"2026-10-07",mode:"BYN" as const};
export async function cashStatementBaseline(db:PrismaClient){
 const result:Record<string,unknown>={};
 for(const table of ["User","Payment","Payout","CashAccount","PayrollEntry","FinanceDocument","StockMovement","StockPurchase","ChangeLog","DomainEvent"])
  result[table]=await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS digest FROM "${table}" t`);
 return result;
}
export async function createCashStatementFixture(tx:Prisma.TransactionClient,marker:string){
 const user=await tx.user.create({data:{id:marker,email:marker+"@invalid.local",name:"QA105 Снабженец",passwordHash:"qa-login-disabled",roles:["PROCUREMENT"]}});
 const byn=await tx.cashAccount.create({data:{id:marker+"-byn",name:"QA105 Касса BYN",currency:"BYN"}});
 const usd=await tx.cashAccount.create({data:{id:marker+"-usd",name:"QA105 Касса USD",currency:"USD",active:false}});
 const unknown=await tx.cashAccount.create({data:{id:marker+"-unknown",name:"QA105 Неполная история",currency:"EUR"}});
 const payment=async(id:string,cashAccountId:string,amount:number,bynAmount:number,currency:string,paidAt:string,direction:"INCOME"|"EXPENSE"="INCOME")=>
  tx.payment.create({data:{id:marker+"-"+id,cashAccountId,amount,bynAmount,currency,rate:currency==="BYN"?1:3,paidAt:new Date(paidAt),direction,comment:marker,createdById:marker}});
 await payment("opening",byn.id,100,100,"BYN","2026-10-06T20:59:59.999Z");
 await payment("income",byn.id,50,50,"BYN","2026-10-06T21:00:00.000Z");
 await payment("expense",byn.id,10,10,"BYN","2026-10-07T08:00:00.000Z","EXPENSE");
 await payment("tomorrow",byn.id,999,999,"BYN","2026-10-07T21:00:00.000Z");
 await payment("usd-opening",usd.id,100,300,"USD","2026-10-06T20:59:59.999Z");
 await payment("usd-expense",usd.id,10,33,"USD","2026-10-07T08:00:00.000Z","EXPENSE");
 const rates={cashRate:1,payrollRate:1,cashRateDate:new Date("2026-10-07"),payrollRateDate:new Date("2026-10-07"),payrollCurrency:"BYN"};
 await tx.payout.createMany({data:[
  {...rates,id:marker+"-salary",userId:marker,kind:"SALARY",amount:20,month:"2026-09",cashAccountId:byn.id,cashAmount:20,cashCurrency:"BYN",bynAmount:20,createdAt:new Date("2026-10-07T10:00:00Z")},
  {...rates,id:marker+"-advance",userId:marker,kind:"ADVANCE",amount:5,month:"2026-10",cashAccountId:byn.id,cashAmount:5,cashCurrency:"BYN",bynAmount:5,createdAt:new Date("2026-10-07T20:59:59.999Z")},
  {...rates,cashRate:3,id:marker+"-usd-salary",userId:marker,kind:"SALARY",amount:15,month:"2026-09",cashAccountId:usd.id,cashAmount:5,cashCurrency:"USD",bynAmount:15,createdAt:new Date("2026-10-07T10:00:00Z")},
  {id:marker+"-unknown-payout",userId:marker,kind:"SALARY",amount:7,month:"2026-09",createdAt:new Date("2026-10-01T10:00:00Z")},
  {id:marker+"-unassigned",userId:marker,kind:"ADVANCE",amount:3,month:"2026-10",createdAt:new Date("2026-10-07T10:00:00Z")},
 ]});
 await tx.payrollEntry.create({data:{id:marker+"-accrued",userId:marker,amount:999999,bynAmount:999999,currency:"BYN",month:"2026-10"}});
 return {user,byn,usd,unknown};
}
export async function deleteCashStatementFixture(tx:Prisma.TransactionClient,marker:string){
 await tx.payment.deleteMany({where:{createdById:marker,comment:marker}});
 await tx.payout.deleteMany({where:{userId:marker}});
 await tx.payrollEntry.deleteMany({where:{id:marker+"-accrued",userId:marker}});
 await tx.cashAccount.deleteMany({where:{id:{in:[marker+"-byn",marker+"-usd",marker+"-unknown"]}}});
 await tx.user.deleteMany({where:{id:marker,email:marker+"@invalid.local"}});
}
