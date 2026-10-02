import assert from "node:assert/strict";
import test from "node:test";
import { buildBynPricePlan, classifyConversionState, projectCalendarDate, validateHistoricalRate, type CurrentProjectPrices } from "../scripts/byn-price-conversion/planner";
import { fetchHistoricalEvidence } from "../scripts/byn-price-conversion/nbrb";
import {buildProductionAppPriceReport,productionAppRateRequests} from "../scripts/byn-price-conversion/app-report";
const catalog=JSON.stringify([{Cur_ID:456,Cur_Abbreviation:"RUB",Cur_Scale:100,Cur_DateStart:"2021-07-09T00:00:00",Cur_DateEnd:"2050-01-01T00:00:00"}]);
const raw=JSON.stringify({Cur_ID:456,Date:"2024-01-06T00:00:00",Cur_Abbreviation:"RUB",Cur_Scale:100,Cur_OfficialRate:3.4998});
const rate=()=>validateHistoricalRate("RUB","2024-01-06",catalog,raw);
const source=():CurrentProjectPrices=>({id:"p",number:"205",title:"Тест",currency:"RUB",createdAt:"2024-01-05T22:00:00.000Z",initialPrice:"100.00",delivery:"1.00",unloading:null,installation:"0",products:[{id:"a",projectId:"p",number:"205.1",title:"Тестовое изделие",quantity:3,expectedPrice:"0.15",initialPrice:null}]});
test("Project Moscow calendar wins over UTC day and invalid/ambiguous/pre-BYN dates stop",()=>{
 assert.equal(projectCalendarDate("2024-01-05T22:00:00.000Z"),"2024-01-06");assert.equal(projectCalendarDate("2024-01-05T20:59:59.999Z"),"2024-01-05");
 for(const value of ["bad","2024-01-05","2015-01-05T00:00:00.000Z","2024-02-30T00:00:00.000Z"])assert.throws(()=>projectCalendarDate(value));
});
test("RUB scale applied exactly; unit rounded before quantity; null and service/initial rows remain separate",()=>{
 const plan=buildBynPricePlan([source()],[rate()]);const unit=plan.rows.find(row=>row.model==="Product"&&row.field==="expectedPrice")!;
 assert.equal(unit.before,"0.15");assert.equal(unit.after,"0.01");assert.equal(unit.lineAfter,"0.03");assert.equal(unit.quantity,3);
 assert.equal(plan.rows.find(row=>row.model==="Product"&&row.field==="initialPrice")!.after,null);
 assert.equal(plan.rows.find(row=>row.model==="Project"&&row.field==="initialPrice")!.after,"3.50");assert.equal(plan.rows.find(row=>row.field==="unloading")!.after,null);
 assert.equal(plan.rows.find(row=>row.field==="installation")!.after,"0.00");assert.equal(plan.projects[0].after.currency,"BYN");assert.equal(plan.projects[0].after.products[0].quantity,3);
});
test("only current currency selects conversion; BYN is not guessed foreign from price or title",()=>{
 const original=source();original.currency="BYN";original.products[0].expectedPrice="999999.00";assert.equal(buildBynPricePlan([original],[]).projects.length,0);
 assert.throws(()=>buildBynPricePlan([source()],[]),/MISSING_FX/);
});
test("wrong FX date, scale, identity, duplicates, stale validity and malformed values stop",()=>{
 for(const patch of [{Date:"2024-01-05T00:00:00"},{Cur_Scale:1},{Cur_ID:999},{Cur_OfficialRate:0},{Cur_OfficialRate:-1},{Cur_OfficialRate:"NaN"}])assert.throws(()=>validateHistoricalRate("RUB","2024-01-06",catalog,JSON.stringify({...JSON.parse(raw),...patch})));
 assert.throws(()=>validateHistoricalRate("RUB","2024-01-06",JSON.stringify([...JSON.parse(catalog),...JSON.parse(catalog)]),raw));
 assert.throws(()=>validateHistoricalRate("RUB","2020-01-06",catalog,raw));assert.throws(()=>buildBynPricePlan([source()],[rate(),rate()]));
 for(const price of ["NaN","Infinity","-1","1,25","1e2","1.001"]){const row=source();row.delivery=price;assert.throws(()=>buildBynPricePlan([row],[rate()]));}
 const duplicate=source();duplicate.products.push({...duplicate.products[0]});assert.throws(()=>buildBynPricePlan([duplicate],[rate()]));
});
test("exact before/after classify idempotence; stale/mixed/quantity changes are refused",()=>{
 const original=source(),plan=buildBynPricePlan([original],[rate()]);assert.equal(classifyConversionState(plan,[original]),"BEFORE");assert.equal(classifyConversionState(plan,[plan.projects[0].after]),"AFTER");
 const stale=source();stale.products[0].expectedPrice="0.16";assert.throws(()=>classifyConversionState(plan,[stale]));stale.products[0].quantity=4;assert.throws(()=>classifyConversionState(plan,[stale]));
 const mixed=source();mixed.currency="BYN";assert.throws(()=>classifyConversionState(plan,[mixed]));
});
test("official fetch uses abbreviation+ondate, keeps raw evidence; missing HTTP never falls back",async()=>{
 const urls:string[]=[];const evidence=await fetchHistoricalEvidence([{currency:"RUB",date:"2024-01-06"}],async url=>{urls.push(String(url));return new Response(String(url).endsWith("/currencies")?catalog:raw,{status:200});});
 assert.equal(evidence.rates.length,1);assert.equal(evidence.catalogRaw,catalog);assert.match(urls[1],/rates\/RUB\?parammode=2&ondate=2024-01-06/);assert.match(evidence.rates[0].rawSha256,/^[a-f0-9]{64}$/);assert.equal(evidence.rates[0].rawResponse,raw);
 await assert.rejects(fetchHistoricalEvidence([{currency:"RUB",date:"2024-01-06"}],async()=>new Response("",{status:404})),/NBRB_HTTP/);
});
test("app-only manual report keeps unavailable distinct from known null and never assumes quantity or date",()=>{
 const unavailable={status:"unavailable"},knownNull={status:"known-null",value:null};
 const app={kind:"production-app-price-plan-readonly",origin:"https://example.invalid",scope:{directDbAccess:false,businessPosts:0},projects:[{id:"p",number:"205",title:"Synthetic app source",currency:"RUB",createdAt:{status:"available",value:"2024-01-05T22:00:00.000Z"},initialPrice:unavailable,services:{delivery:knownNull,unloading:unavailable,installation:{status:"available",value:"10"}},products:[{id:"x",number:"205.1",title:"Synthetic",expectedPrice:{status:"available",value:"0.15"},initialPrice:unavailable,quantity:unavailable}]}]};
 const report=buildProductionAppPriceReport(app,[rate()]);const missing=report.plan.rows.find(row=>row.model==="Product"&&row.field==="initialPrice")!;assert.equal(missing.conversionStatus,"APP_FIELD_UNAVAILABLE");assert.equal(Object.hasOwn(missing,"before"),false);assert.equal(Object.hasOwn(missing,"after"),false);
 assert.deepEqual(productionAppRateRequests(app),[{currency:"RUB",date:"2024-01-06"}]);
 const unit=report.plan.rows.find(row=>row.model==="Product"&&row.field==="expectedPrice")!;assert.equal(unit.after,"0.01");assert.equal(unit.conversionStatus,"QUANTITY_UNAVAILABLE");assert.equal(Object.hasOwn(unit,"lineBefore"),false);assert.equal(Object.hasOwn(unit,"lineAfter"),false);
 assert.equal(report.plan.rows.find(row=>row.field==="delivery")!.before,null);app.projects[0].createdAt={status:"unavailable",value:""};const dateMissing=buildProductionAppPriceReport(app,[rate()]);assert.equal(dateMissing.plan.rows.find(row=>row.model==="Product"&&row.field==="expectedPrice")!.conversionStatus,"PROJECT_CREATED_AT_UNAVAILABLE");
 assert.throws(()=>productionAppRateRequests(app),/APP_RATE_BASIS_UNAVAILABLE/);
 assert.throws(()=>buildProductionAppPriceReport({...app,scope:{directDbAccess:true,businessPosts:0}},[]),/ACTUAL_APP_EXPORT/);
});
