import assert from "node:assert/strict";
import test from "node:test";
import {createProductTechnicalEditor,technicalRowDraft} from "../src/lib/product-technical-editor";
import type {ProductPatch,ProductPatchResult} from "../src/server/products/patch-contract";
import type {TechnicalSpecifications} from "@pero/kp-template";
import {parseLegacyProductDescription} from "../src/lib/product-legacy-specifications";
const initial:TechnicalSpecifications={sections:[{id:"first",type:"custom",group:"construction",label:"Мой заголовок",value:"Дуб"},{id:"second",type:"hardware",group:"hardware",label:"Петли",value:"Blum"}],description:null,size:null,note:null,sourceGeneration:1};
function setup(send?:(patch:ProductPatch)=>Promise<ProductPatchResult>,source:TechnicalSpecifications|null=initial){let n=0;const patches:ProductPatch[]=[];const editor=createProductTechnicalEditor({productId:"p",initial:source,id:()=>`id-${++n}`,send:async patch=>{patches.push(patch);if(send)return send(patch);assert.equal(patch.field,"technicalSpecificationRow");return{kind:"saved",field:patch.field,value:patch.field==="technicalSpecificationRow"?patch.row:null,clientMutationId:patch.clientMutationId};}});return{editor,patches};}
test("исходный порядок/custom/названия и одна нетронутая завершающая строка без записи",async()=>{const{editor,patches}=setup();assert.deepEqual(editor.getSnapshot().rows,["first","second","id-1"]);assert.equal(technicalRowDraft(editor.section("first").getSnapshot().draft).label,"Мой заголовок");assert.equal(await editor.flush(),true);assert.equal(patches.length,0);});
test("первый ввод сохраняет пару с UUID строки, ACK не меняет ключ, после пустой очистки удаляет",async()=>{const{editor,patches}=setup(undefined,null);const key=editor.getSnapshot().trailing;editor.setActive(key,true);editor.setRow(key,{label:"Заголовок",value:"Значение"});assert.equal(editor.getSnapshot().rows.length,2);await editor.flush();const first=patches[0];assert.ok(first.field==="technicalSpecificationRow");assert.equal(first.sectionId,key);assert.equal(first.clientMutationId,key);assert.deepEqual(first.expectedRow,null);assert.deepEqual(first.row,{label:"Заголовок",value:"Значение"});editor.setRow(key,{label:"",value:""});await editor.flush();assert.equal(editor.getSnapshot().rows.includes(key),true);editor.setActive(key,false);assert.equal(editor.getSnapshot().rows.includes(key),false);const deletion=patches[1];assert.ok(deletion.field==="technicalSpecificationRow");assert.equal(deletion.row,null);assert.notEqual(deletion.clientMutationId,key);});
test("lost ACK повторяет точную пару и UUID, новый ввод и название остаются",async()=>{let attempts=0;const{editor,patches}=setup(async patch=>{assert.ok(patch.field==="technicalSpecificationRow");if(++attempts===1)throw Error("lost");return{kind:"saved",field:patch.field,value:patch.row,clientMutationId:patch.clientMutationId};},null);const key=editor.getSnapshot().trailing;editor.setRow(key,{label:"Новый",value:"1"});assert.equal(await editor.section(key).commit(),false);editor.setRow(key,{label:"Ещё новее",value:"2"});await editor.section(key).retry();assert.deepEqual(patches[0],patches[1]);assert.deepEqual(technicalRowDraft(editor.section(key).getSnapshot().draft),{label:"Ещё новее",value:"2"});await editor.flush();assert.deepEqual(technicalRowDraft(editor.section(key).getSnapshot().baseline!),{label:"Ещё новее",value:"2"});});
test("новое поколение не меняет dirty baseline, соседняя строка сохраняется независимо",async()=>{const{editor,patches}=setup(async patch=>{assert.ok(patch.field==="technicalSpecificationRow");return patch.sectionId==="first"?{kind:"conflict",field:patch.field,error:"Источник изменился",clientMutationId:patch.clientMutationId}:{kind:"saved",field:patch.field,value:patch.row,clientMutationId:patch.clientMutationId};});editor.setRow("first",{label:"Моё",value:"Ясень"});editor.receive({...initial,sourceGeneration:2});editor.setRow("second",{label:"Направляющие",value:"Hettich"});assert.equal(await editor.flush(),false);const first=patches.find(p=>p.field==="technicalSpecificationRow"&&p.sectionId==="first");assert.ok(first?.field==="technicalSpecificationRow");assert.equal(first.expectedSourceGeneration,1);assert.deepEqual(first.expectedRow,{label:"Мой заголовок",value:"Дуб"});assert.equal(technicalRowDraft(editor.section("first").getSnapshot().draft).label,"Моё");});

test("второе создание ждёт первое даже при общем flush и более раннем commit второй строки",async()=>{
 let release!:()=>void;const calls:string[]=[];
 const {editor}=setup(async patch=>{assert.ok(patch.field==="technicalSpecificationRow");calls.push(patch.sectionId);if(calls.length===1)await new Promise<void>(resolve=>{release=resolve;});return{kind:"saved",field:patch.field,value:patch.row,clientMutationId:patch.clientMutationId};},null);
 const first=editor.getSnapshot().trailing;editor.setRow(first,{label:"A",value:"1"});const second=editor.getSnapshot().trailing;editor.setRow(second,{label:"B",value:"2"});
 const secondSaving=editor.section(second).commit();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[first]);const flush=editor.flush();release();assert.equal(await secondSaving,true);assert.equal(await flush,true);assert.deepEqual(calls,[first,second]);
});

test("старый снимок после ACK создания/удаления/правки не отменяет подтверждённое изменение",async()=>{
 let revision=0;
 const saved=async(patch:ProductPatch):Promise<ProductPatchResult>=>{assert.ok(patch.field==="technicalSpecificationRow");return{kind:"saved",field:patch.field,value:patch.row,clientMutationId:patch.clientMutationId,derived:{technicalSpecificationsEditRevision:++revision}};};
 const created=setup(saved,null),key=created.editor.getSnapshot().trailing;
 created.editor.setRow(key,{label:"Новый",value:"1"});await created.editor.flush();created.editor.receive(null);assert.ok(created.editor.getSnapshot().rows.includes(key));
 created.editor.setRow(key,{label:"Новее",value:"2"});await created.editor.flush();
 created.editor.receive({sections:[{id:key,type:"custom",group:"construction",label:"Новый",value:"1"}],description:null,size:null,note:null,sourceGeneration:0,editRevision:1});
 assert.deepEqual(technicalRowDraft(created.editor.section(key).getSnapshot().draft),{label:"Новее",value:"2"});
 created.editor.setRow(key,{label:"",value:""});await created.editor.flush();created.editor.receive({sections:[{id:key,type:"custom",group:"construction",label:"Новее",value:"2"}],description:null,size:null,note:null,sourceGeneration:0,editRevision:2});assert.equal(created.editor.getSnapshot().rows.includes(key),false);
 created.editor.receive({sections:[{id:"fresh",type:"custom",group:"construction",label:"Другой сотрудник",value:"3"}],description:null,size:null,note:null,sourceGeneration:0,editRevision:4});assert.equal(technicalRowDraft(created.editor.section("fresh").getSnapshot().draft).label,"Другой сотрудник");
});
test("поздний ACK gen2/rev7 не поднимает revision свежего КП gen3/rev0",async()=>{
 let release!:()=>void;
 const {editor}=setup(async patch=>{assert.ok(patch.field==="technicalSpecificationRow");await new Promise<void>(resolve=>{release=resolve;});return{kind:"saved",field:patch.field,value:patch.row,clientMutationId:patch.clientMutationId,derived:{technicalSpecificationsEditRevision:7}};},{...initial,sourceGeneration:2,editRevision:0});
 editor.setRow("first",{label:"Черновик",value:"2"});const pending=editor.section("first").commit();
 const fresh={...initial,sourceGeneration:3,editRevision:0,sections:[{...initial.sections[0],label:"КП gen3",value:"Актуальное"}]};editor.receive(fresh);release();await pending;
 editor.receive(fresh);assert.deepEqual(technicalRowDraft(editor.section("first").getSnapshot().draft),{label:"КП gen3",value:"Актуальное"});
});

test("legacy строки отображаются без записи, первая правка сохраняет raw baseline и принимает полный ACK",async()=>{
 const legacyDescription="Каркас: ЛДСП\nФасад: МДФ\nСвободный текст",initialLegacy=parseLegacyProductDescription(legacyDescription),patches:ProductPatch[]=[];
 const editor=createProductTechnicalEditor({productId:"p",initial:null,legacyDescription,id:()=>"trailing",send:async patch=>{patches.push(patch);assert.ok(patch.field==="technicalSpecificationRow");return{kind:"saved",field:patch.field,value:patch.row,clientMutationId:patch.clientMutationId,derived:{technicalSpecificationsEditRevision:1,technicalSpecifications:{...initialLegacy,editRevision:1,sections:initialLegacy.sections.map(row=>row.id===patch.sectionId?{...row,...patch.row}:row)}}};}});
 assert.deepEqual(editor.getSnapshot().rows,[...initialLegacy.sections.map(row=>row.id),"trailing"]);assert.equal(await editor.flush(),true);assert.equal(patches.length,0);
 const first=initialLegacy.sections[0];editor.setRow(first.id,{label:first.label,value:"Дуб"});await editor.flush();assert.ok(patches[0].field==="technicalSpecificationRow");assert.equal(patches[0].expectedLegacyDescription,legacyDescription);assert.deepEqual(patches[0].expectedRow,{label:first.label,value:first.value});
 assert.equal(technicalRowDraft(editor.section(initialLegacy.sections[1].id).getSnapshot().draft).value,initialLegacy.sections[1].value);
 editor.receive(null,legacyDescription);assert.equal(technicalRowDraft(editor.section(first.id).getSnapshot().draft).value,"Дуб");
 editor.setRow(first.id,{label:first.label,value:"Ясень"});await editor.flush();assert.ok(patches[1].field==="technicalSpecificationRow");assert.equal(Object.hasOwn(patches[1],"expectedLegacyDescription"),false);
});

test("грязная legacy строка держит свой raw CAS после получения нового исходного текста",async()=>{
 const original="Каркас: ЛДСП\nФасад: МДФ",fresh="Каркас: ЛДСП\nФасад: Шпон",parsed=parseLegacyProductDescription(original),patches:ProductPatch[]=[];
 const editor=createProductTechnicalEditor({productId:"p",initial:null,legacyDescription:original,id:()=>"trailing",send:async patch=>{patches.push(patch);return{kind:"conflict",field:patch.field,error:"Исходное описание изменилось",clientMutationId:patch.clientMutationId};}});
 editor.setRow(parsed.sections[0].id,{label:"Каркас",value:"Черновик"});editor.receive(null,fresh);editor.setRow(parsed.sections[1].id,{label:"Фасад",value:"Новый фасад"});assert.equal(await editor.flush(),false);
 const [first,second]=patches;assert.ok(first.field==="technicalSpecificationRow"&&second.field==="technicalSpecificationRow");assert.equal(first.expectedLegacyDescription,original);assert.equal(second.expectedLegacyDescription,fresh);assert.equal(technicalRowDraft(editor.section(parsed.sections[0].id).getSnapshot().draft).value,"Черновик");
});

test("явный пустой JSON и JSON receive не возвращают старое описание",async()=>{
 const empty={sections:[],description:null,size:null,note:null,sourceGeneration:0,editRevision:1};
 const editor=createProductTechnicalEditor({productId:"p",initial:empty,legacyDescription:"Каркас: ЛДСП",id:()=>"trailing",send:async()=>{throw Error("Чтение не сохраняет");}});
 assert.deepEqual(editor.getSnapshot().rows,["trailing"]);editor.receive(empty,"Фасад: МДФ");assert.deepEqual(editor.getSnapshot().rows,["trailing"]);assert.equal(await editor.flush(),true);
});

test("полный ACK материализации сохраняет свежий ввод, соседний черновик и новые локальные строки",async()=>{
 const raw="Каркас: ЛДСП\nФасад: МДФ",legacy=parseLegacyProductDescription(raw),[first,second]=legacy.sections;let release!:(reply:ProductPatchResult)=>void,n=0;
 const editor=createProductTechnicalEditor({productId:"p",initial:null,legacyDescription:raw,id:()=>`local-${++n}`,send:()=>new Promise(resolve=>{release=resolve;})});
 editor.setRow(first.id,{label:"Каркас",value:"Первая правка"});const pending=editor.section(first.id).commit();editor.setRow(first.id,{label:"Каркас",value:"Более свежая правка"});editor.setRow(second.id,{label:"Фасад",value:"Локальный фасад"});const added=editor.getSnapshot().trailing;editor.setRow(added,{label:"Своя строка",value:"Новая"});const keys=editor.getSnapshot().rows;
 release({kind:"saved",field:"technicalSpecificationRow",value:{label:"Каркас",value:"Первая правка"},clientMutationId:"ack",derived:{technicalSpecificationsEditRevision:1,technicalSpecifications:{...legacy,editRevision:1,sections:legacy.sections.map(row=>row.id===first.id?{...row,value:"Первая правка"}:row)}}});assert.equal(await pending,true);
 assert.deepEqual(editor.getSnapshot().rows,keys);assert.equal(technicalRowDraft(editor.section(first.id).getSnapshot().draft).value,"Более свежая правка");assert.equal(technicalRowDraft(editor.section(second.id).getSnapshot().draft).value,"Локальный фасад");assert.equal(technicalRowDraft(editor.section(added).getSnapshot().draft).value,"Новая");
});

test("пробел в активной новой legacy строке не лишает следующий текст raw CAS",async()=>{
 const patches:ProductPatch[]=[];let n=0;
 const editor=createProductTechnicalEditor({productId:"p",initial:null,legacyDescription:null,id:()=>`space-${++n}`,send:async patch=>{
  patches.push(patch);assert.ok(patch.field==="technicalSpecificationRow");
  if(!patch.row?.label.trim()&&!patch.row?.value.trim())return{kind:"saved",field:patch.field,value:null,noOp:true,clientMutationId:patch.clientMutationId};
  if(!Object.hasOwn(patch,"expectedLegacyDescription"))return{kind:"conflict",field:patch.field,error:"Нет исходного legacy baseline",clientMutationId:patch.clientMutationId};
  return{kind:"saved",field:patch.field,value:patch.row,clientMutationId:patch.clientMutationId};
 }});
 const key=editor.getSnapshot().trailing;editor.setActive(key,true);editor.setRow(key,{label:" ",value:""});assert.equal(await editor.section(key).commit(),true);
 editor.setRow(key,{label:"Каркас",value:"  Дуб  "});assert.equal(await editor.section(key).commit(),true);const saved=patches.at(-1);assert.ok(saved?.field==="technicalSpecificationRow");assert.equal(saved.expectedLegacyDescription,null);assert.deepEqual(saved.row,{label:"Каркас",value:"  Дуб  "});assert.ok(editor.getSnapshot().rows.includes(key));
});

test("backend noOp без materialized snapshot сохраняет legacy baseline для следующего ввода",async()=>{
 const patches:ProductPatch[]=[];let n=0;
 const editor=createProductTechnicalEditor({productId:"p",initial:null,legacyDescription:null,id:()=>`noop-${++n}`,send:async patch=>{
  patches.push(patch);assert.ok(patch.field==="technicalSpecificationRow");
  return{kind:"saved",field:patch.field,value:patches.length===1?null:patch.row,noOp:patches.length===1,clientMutationId:patch.clientMutationId};
 }});
 const key=editor.getSnapshot().trailing;editor.setActive(key,true);editor.setRow(key,{label:"До noOp",value:""});assert.equal(await editor.section(key).commit(),true);
 editor.setRow(key,{label:"После noOp",value:"Дуб"});assert.equal(await editor.section(key).commit(),true);assert.equal(patches.length,2);assert.ok(patches[1].field==="technicalSpecificationRow");assert.equal(Object.hasOwn(patches[1],"expectedLegacyDescription"),true);assert.equal(patches[1].expectedLegacyDescription,null);
});

test("нетронутый whitespace-only ввод не отправляется в backend",async()=>{
 const{editor,patches}=setup(undefined,null);const key=editor.getSnapshot().trailing;editor.setActive(key,true);editor.setRow(key,{label:" \t",value:" \n"});assert.equal(await editor.section(key).commit(),true);assert.equal(patches.length,0);
});
