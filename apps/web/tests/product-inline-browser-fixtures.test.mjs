import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {test} from 'node:test';
const source=readFileSync(new URL('./product-inline-browser-fixtures.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/await main\(\);\s*$/,'');
const api=Function('Prisma','createHash','createHmac','randomUUID','timingSafeEqual',`${source};return{signed,verify,immutableRows,effects,cleanup};`)({ModelName:{}},createHash,createHmac,randomUUID,timingSafeEqual);
const namespace='PERO_PRODUCT_INLINE_BROWSER_FIXTURES_V1';
function scope(){const ids={project:randomUUID(),productA:randomUUID(),productB:randomUUID(),clientA:randomUUID(),clientB:randomUUID()};const rows={clients:[{id:ids.clientA,name:'A',phone:'100'},{id:ids.clientB,name:'B',phone:'999'}],projects:[{id:ids.project,number:'1',clientId:ids.clientA,address:null}],products:[{id:ids.productA,projectId:ids.project,number:'1.1',status:'DESIGN',title:'A'},{id:ids.productB,projectId:ids.project,number:'1.2',status:'DESIGN',title:'B'}]};return{namespace,kind:'checkpoint',runId:randomUUID(),target:'local',ids,actors:{manager:{id:'manager',roles:['MANAGER']}},originalRows:rows,baseline:{}}}
test('signed fixture scope cannot be edited to delete unrelated rows',()=>{const cp=api.signed(scope(),'secret');api.verify(cp,'secret','checkpoint');const changed=structuredClone(cp);changed.ids.productA='existing';assert.throws(()=>api.verify(changed,'secret','checkpoint'),/SIGNATURE_MISMATCH/)});
test('owned mutable UI fields permitted while foreign binding and frozen status refuse cleanup',()=>{const cp=scope();const rows=structuredClone(cp.originalRows);rows.clients[0].phone='200';rows.products[0].title='Changed';rows.products[0].status='RECLAMATION';api.immutableRows(cp,rows);rows.products[0].status='PRODUCTION';assert.throws(()=>api.immutableRows(cp,rows),/FROZEN_STATUS_FORBIDDEN_STOP/);rows.products[0].status='DESIGN';rows.products[0].projectId='existing';assert.throws(()=>api.immutableRows(cp,rows),/OWNED_IMMUTABLE_CHANGED_STOP/)});
test('uncaptured mutation receipt and unrelated actor stop ownership observation',async()=>{const cp=scope();const id=randomUUID();const log={id:`product-inline:${id}`,entity:'product',entityId:cp.ids.productA,action:'inline.update',actorType:'user',actorId:'manager',source:'web'};const tx={changeLog:{findMany:async()=>[log]}};await assert.rejects(api.effects(tx,cp,[]),/UNCAPTURED_MUTATION_STOP/);log.actorId='other';await assert.rejects(api.effects(tx,cp,[id]),/NONOWNED_AUDIT_ACTOR_STOP/)});
test('actual contact audit and object-shaped receipt authorize exact owned effect IDs',async()=>{
 const cp=scope();const id=randomUUID();const receipt={id:`product-inline:${id}`,entity:'product',entityId:cp.ids.productA,action:'inline.update',field:'project.address',actorType:'user',actorId:'manager',source:'web',oldValue:{value:null},newValue:{fingerprint:'a'.repeat(64),result:{kind:'saved',field:'project.address',clientMutationId:id,value:'Shared',derived:{clientId:cp.ids.clientA}}}};
 const contact={id:randomUUID(),entity:'project',entityId:cp.ids.project,action:'update',field:'address',actorType:'user',actorId:'manager',source:'web',oldValue:{address:null},newValue:{address:'Shared'}};
 const tx={changeLog:{findMany:async()=>[receipt,contact]},domainEvent:{findMany:async()=>[]},productStatusHistory:{findMany:async()=>[]},notification:{findMany:async()=>[]}};
 const effects=await api.effects(tx,cp,[id]);assert.deepEqual(effects.ChangeLog.map(row=>row.id),[receipt.id,contact.id]);
});

test('unknown receipt oldValue shapes cannot authorize contact cleanup',async()=>{
 const cp=scope();const id=randomUUID();const receipt={id:`product-inline:${id}`,entity:'product',entityId:cp.ids.productA,action:'inline.update',field:'client.phone',actorType:'user',actorId:'manager',source:'web',oldValue:'100',newValue:{fingerprint:'a'.repeat(64),result:{kind:'saved',field:'client.phone',clientMutationId:id,value:'200',derived:{clientId:cp.ids.clientA}}}};
 await assert.rejects(api.effects({changeLog:{findMany:async()=>[receipt]}},cp,[id]),/RECEIPT_SHAPE_UNSUPPORTED_STOP/);
});
test('owned event lookup uses the generated Prisma JSON equals predicate exactly',async()=>{
 const cp=scope();const tx={changeLog:{findMany:async()=>[]},domainEvent:{findMany:async({where})=>{assert.equal(where.OR.length,5);for(const condition of where.OR){assert.deepEqual(Object.keys(condition.payload).sort(),['equals','path']);assert.ok([cp.ids.productA,cp.ids.productB,cp.ids.project,cp.ids.clientA,cp.ids.clientB].includes(condition.payload.equals));}return[]}},productStatusHistory:{findMany:async()=>[]},notification:{findMany:async()=>[]}};
 await api.effects(tx,cp,[]);
});
