import {Prisma, type PrismaClient, type DomainEventDelivery} from "@prisma/client";
import {EventDeliveryError,eventRetryDelay,type EventQueueSettings,type OwnedDomainEvent} from "./event-queue-contract";

export type SubscriberDelivery = DomainEventDelivery;
export type SubscriberDeliveryStore = {
  initialize(event:OwnedDomainEvent,subscribers:readonly string[]):Promise<SubscriberDelivery[]>;
  begin(event:OwnedDomainEvent,subscriberId:string):Promise<"started"|"terminal"|"deferred">;
  complete(event:OwnedDomainEvent,subscriberId:string):Promise<void>;
  fail(event:OwnedDomainEvent,subscriberId:string):Promise<void>;
  skip(event:OwnedDomainEvent,subscriberId:string,reason:"SUBSCRIBER_DISABLED"|"SUBSCRIBER_UNAVAILABLE"):Promise<void>;
};
type Database=Pick<PrismaClient,"$transaction">;

/** Очередь135 остаётся владельцем lease/budget; receipts не запускают отдельный scheduler. */
export function createPostgresSubscriberStore(db:Database,settings:Readonly<EventQueueSettings>,ownedScope?:readonly string[]):SubscriberDeliveryStore {
  async function owned<T>(event:OwnedDomainEvent,work:(tx:Prisma.TransactionClient,now:Date)=>Promise<T>):Promise<T>{
    if(ownedScope!==undefined&&!ownedScope.includes(event.id))throw new EventDeliveryError("EVENT_CLAIM_LOST");
    return db.$transaction(async tx=>{
      const locked=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT "id" FROM "DomainEvent"
        WHERE "id"=${event.id} AND "claimToken"=${event.claimToken} AND "processedAt" IS NULL FOR UPDATE`);
      if(locked.length!==1)throw new EventDeliveryError("EVENT_CLAIM_LOST");
      const clock=()=>tx.$queryRaw<{now:Date}[]>(Prisma.sql`SELECT clock_timestamp() AS now FROM "DomainEvent"
        WHERE "id"=${event.id} AND "claimToken"=${event.claimToken} AND "processedAt" IS NULL AND "leaseUntil">clock_timestamp()`);
      // Clock читается отдельным statement после фактического row lock, а не до ожидания.
      const current=(await clock())[0];if(!current)throw new EventDeliveryError("EVENT_CLAIM_LOST");
      const result=await work(tx,current.now);
      if((await clock()).length!==1)throw new EventDeliveryError("EVENT_CLAIM_LOST");
      return result;
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:5000,timeout:10000});
  }
  const key=(event:OwnedDomainEvent,subscriberId:string)=>({eventId_subscriberId:{eventId:event.id,subscriberId}});
  const receipt=async(tx:Prisma.TransactionClient,event:OwnedDomainEvent,id:string)=>{
    const row=await tx.domainEventDelivery.findUnique({where:key(event,id)});
    if(!row)throw new EventDeliveryError("EVENT_DELIVERY_FAILED");return row;
  };
  const terminal=(row:SubscriberDelivery)=>row.deliveredAt!==null||row.skippedAt!==null;
  return {
    initialize:(event,subscribers)=>owned(event,async(tx,now)=>{
      if(!await tx.domainEventDeliveryPlan.findUnique({where:{eventId:event.id}})){
        await tx.domainEventDeliveryPlan.create({data:{eventId:event.id,createdAt:now}});
        const ids=[...new Set(subscribers)];
        if(ids.length)await tx.domainEventDelivery.createMany({data:ids.map((subscriberId,position)=>({eventId:event.id,subscriberId,position,nextAttemptAt:now}))});
      }
      return tx.domainEventDelivery.findMany({where:{eventId:event.id},orderBy:{position:"asc"}});
    }),
    begin:(event,id)=>owned(event,async(tx,now)=>{
      const row=await receipt(tx,event,id);if(terminal(row))return "terminal";
      if(row.nextAttemptAt>now||row.claimToken===event.claimToken)return "deferred";
      await tx.domainEventDelivery.update({where:key(event,id),data:{attempts:{increment:1},claimToken:event.claimToken}});return "started";
    }),
    complete:(event,id)=>owned(event,async(tx,now)=>{
      const row=await receipt(tx,event,id);
      if(row.claimToken!==event.claimToken||terminal(row))throw new EventDeliveryError("EVENT_CLAIM_LOST");
      await tx.domainEventDelivery.update({where:key(event,id),data:{deliveredAt:now,claimToken:null,lastError:null}});
    }),
    fail:(event,id)=>owned(event,async(tx,now)=>{
      const row=await receipt(tx,event,id);if(terminal(row))return;
      if(row.claimToken!==event.claimToken)throw new EventDeliveryError("EVENT_CLAIM_LOST");
      await tx.domainEventDelivery.update({where:key(event,id),data:{claimToken:null,lastError:"PLUGIN_HOOK_FAILED",
        nextAttemptAt:new Date(now.getTime()+eventRetryDelay(row.attempts,settings))}});
    }),
    skip:(event,id,reason)=>owned(event,async(tx,now)=>{
      const row=await receipt(tx,event,id);if(terminal(row))return;
      await tx.domainEventDelivery.update({where:key(event,id),data:{skippedAt:now,claimToken:null,lastError:reason}});
    }),
  };
}