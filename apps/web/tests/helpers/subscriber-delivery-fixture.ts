import { EventDeliveryError } from "../../src/server/plugins/event-queue-contract";
import type { createMemoryEventQueueFixture } from "./event-queue-fixture";
import type { SubscriberDelivery, SubscriberDeliveryStore } from "../../src/server/plugins/event-subscriber-store";

type Queue = ReturnType<typeof createMemoryEventQueueFixture>;
const stores = new WeakMap<Queue, ReturnType<typeof createFixture>>();
function createFixture(queue: Queue) {
  const plans = new Map<string, SubscriberDelivery[]>();
  const owned = (event: Parameters<SubscriberDeliveryStore["initialize"]>[0]) => {
    const row = queue.rows.find(row => row.id === event.id);
    if (!row || row.processedAt || row.claimToken !== event.claimToken || !row.leaseUntil || row.leaseUntil.getTime() <= queue.now())
      throw new EventDeliveryError("EVENT_CLAIM_LOST");
  };
  const find = (event: Parameters<SubscriberDeliveryStore["initialize"]>[0], id: string) => {
    owned(event); const row = plans.get(event.id)?.find(row => row.subscriberId === id);
    if (!row) throw new EventDeliveryError("EVENT_DELIVERY_FAILED"); return row;
  };
  const store: SubscriberDeliveryStore = {
    async initialize(event, ids) {
      owned(event);
      if (!plans.has(event.id)) plans.set(event.id, ids.map((subscriberId, position) => ({eventId:event.id,subscriberId,position,
        attempts:0,nextAttemptAt:new Date(queue.now()),deliveredAt:null,skippedAt:null,lastError:null,claimToken:null})));
      return structuredClone(plans.get(event.id)!);
    },
    async begin(event, id) {
      const row=find(event,id); if(row.deliveredAt || row.skippedAt)return "terminal";
      if(row.nextAttemptAt.getTime()>queue.now() || row.claimToken===event.claimToken)return "deferred";
      row.attempts++;row.claimToken=event.claimToken;return "started";
    },
    async complete(event,id){const row=find(event,id);if(row.claimToken!==event.claimToken)throw new EventDeliveryError("EVENT_CLAIM_LOST");
      row.deliveredAt=new Date(queue.now());row.claimToken=null;row.lastError=null;},
    async fail(event,id){const row=find(event,id);if(row.deliveredAt || row.skippedAt)return;
      if(row.claimToken!==event.claimToken)throw new EventDeliveryError("EVENT_CLAIM_LOST");
      row.claimToken=null;row.lastError="PLUGIN_HOOK_FAILED";
      row.nextAttemptAt=new Date(queue.now()+Math.min(queue.settings.backoffMaxMs,queue.settings.backoffBaseMs*2**(row.attempts-1)));},
    async skip(event,id,reason){const row=find(event,id);if(row.deliveredAt || row.skippedAt)return;
      row.skippedAt=new Date(queue.now());row.claimToken=null;row.lastError=reason;},
  };
  return {store,plans};
}
export function memorySubscriberFixture(queue: Queue) {
  let fixture=stores.get(queue);if(!fixture){fixture=createFixture(queue);stores.set(queue,fixture);}return fixture;
}