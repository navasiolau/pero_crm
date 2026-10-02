// Root-only bounded transport entry. Import/build does not execute this module elsewhere.
import {PrismaClient} from '@prisma/client';
import {priceTargetBinding,inventoryPrices,sealPricePlan,applyPricePlan} from '../scripts/byn-price-conversion/core';
import {validatePricePacket} from '../scripts/byn-price-conversion/packet';
const stop=(ok,code)=>{if(!ok)throw Error(code)};
let db,phase='envelope';
try{
 const encoded=process.env.CRM_STAGING_BROWSER_INPUT;delete process.env.CRM_STAGING_BROWSER_INPUT;stop(typeof encoded==='string'&&encoded.length>0&&encoded.length<=96*1024,'PRICE_BOUNDED_INPUT_REQUIRED');const bytes=Buffer.from(encoded,'base64');stop(bytes.toString('base64')===encoded,'PRICE_CANONICAL_INPUT_REQUIRED');const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 validatePricePacket(input);
 phase='target';const binding=priceTargetBinding(input),secret=process.env.AUTH_SECRET??process.env.NEXTAUTH_SECRET;stop(typeof secret==='string'&&secret.length>=16,'PRICE_SECRET_REQUIRED');
 if(input.priceOperation==='seal'){phase='seal';const sealed=sealPricePlan(input.manifest,input.rates,binding,secret);stop(Buffer.byteLength(JSON.stringify(sealed))<=180*1024,'PRICE_SEALED_OUTPUT_BOUNDS');console.log(JSON.stringify({status:'SEALED',sealed}));}
 else{db=new PrismaClient({log:[],errorFormat:'minimal'});phase=input.priceOperation;if(input.priceOperation==='inventory'){const manifest=await inventoryPrices(db,binding,secret);stop(Buffer.byteLength(JSON.stringify(manifest))<=180*1024,'PRICE_MANIFEST_OUTPUT_BOUNDS');console.log(JSON.stringify({status:'INVENTORIED',manifest}));}else console.log(JSON.stringify(await applyPricePlan(db,input.manifest,input.sealed,binding,secret)));}
}catch(error){const code=/^[A-Z0-9_]+$/.test(error.message??'')?error.message:'PRICE_STOP_ROLLBACK_REQUIRED';console.log(JSON.stringify({status:'STOP',phase,code}));process.exitCode=1;}finally{if(db)await db.$disconnect().catch(()=>{});}
