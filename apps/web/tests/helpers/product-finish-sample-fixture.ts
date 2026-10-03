import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import type {TaskTransaction} from '../../src/server/tasks/transaction';
export function snapshotFixture(){const finishId=randomUUID(),assetId=randomUUID();let revision=0;const rows:Record<string,unknown>[]=[];const finish={id:finishId,kind:'ENAMEL',name:'Stored',code:'CODE',color:'Белый',revision:3,active:true,sampleAssetId:assetId};const asset={id:assetId,finishId,fileName:'sample.png',mimeType:'image/png',size:10,deletedAt:null};
 const tx={$queryRaw:async()=>[],task:{findMany:async()=>[]},product:{findFirst:async()=>({id:'p',engineerId:null,status:'DESIGN',finishRevision:revision}),updateMany:async()=>{revision++;return{count:1};}},finish:{findFirst:async()=>finish},catalogueMediaAsset:{findFirst:async()=>asset},productFinishAssignment:{count:async()=>0,create:async({data}:{data:Record<string,unknown>})=>{const row={...data,sampleAssetId:data.sampleAssetId??null,sampleAsset:data.sampleAssetId?asset:null};rows.push(row);return row;}},changeLog:{findUnique:async()=>null,create:async()=>({})}} as unknown as Prisma.TransactionClient;
 const transaction:TaskTransaction=async fn=>fn(tx);return{finish,asset,rows,transaction,input:{op:'add' as const,productId:'p',element:'Корпус',finishId,expectedRevision:0,clientMutationId:randomUUID()}};
}
