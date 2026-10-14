import assert from "node:assert/strict";
import { test } from "node:test";
import { taskReward, taskWorkspaceBindings, taskWorkspaceEligibility } from "../src/server/tasks/workspace-contract";
import { matches, queryRows, type FixtureRow, engineerFixture } from "./helpers/visibility-fixture";
import { type PrismaClient, Prisma, type Role } from "@prisma/client";
import { canCreateOrdinaryWork, canEditOrdinaryWork } from "../src/lib/ordinary-work-access";
import { canAddProductWork } from "../src/server/works/access";
import { addWorkCore } from "../src/server/works/core";
import { listWorkPriceOptions } from "../src/server/works/queries";
import { taskExecutionWhere, hasFullProjectVisibility, productVisibilityWhere, productEditWhere, fileVisibilityWhere } from "../src/server/access/visibility";
import * as role from "../src/lib/roles";
import { homePathForRoles } from "../src/lib/home-route";
import { navItemsForRole } from "../src/lib/nav";
import { taskRecipientError } from "../src/server/tasks/share-policy";
import { authConfig } from "../src/auth.config";
import { canReceiveNotificationContent } from "../src/lib/notification-access";
import { scopeNotificationContent } from "../src/server/access/notification-visibility";
import { receivableTypesFor, orgRolesFor } from "../src/server/notifications/notify";
import { botAllowed, requireBotFinance, requireBotManager } from "../src/server/telegram/bot-api";
import { maskProductionRead } from "../src/server/access/production-read-projection";
import { getProductPercentageView } from "../src/server/product-percentage-pay/queries";

// Источник: task-reward-workspace.test.ts
test('zero and exact allocated Work amount remain known',()=>{
  assert.deepEqual(taskReward({quantity:'2',executorShare:'1'},'0','BYN'),{rewardAmount:'0.00',rewardCurrency:'BYN',rewardSource:'WORK_SNAPSHOT'});
  assert.equal(taskReward({quantity:'3.50',executorShare:'1'},'12.34','BYN').rewardAmount,'43.19');
});
test('historical fixed share is not repriced or multiplied again',()=>{
  const task={quantity:'100',executorShare:'0.5',allocationGroupId:'old',shareAmount:'17.89'};
  assert.equal(taskReward(task,'999','USD').rewardAmount,'17.89');
  assert.equal(taskReward(task,null,'USD').rewardAmount,'17.89');
});
test('unknown price/currency does not become a zero reward',()=>{
  assert.equal(taskReward({quantity:'2',executorShare:'1'},null,'BYN').rewardAmount,null);
  assert.equal(taskReward({quantity:'2',executorShare:'1'},'12',null).rewardAmount,null);
});
test('workspace requires real bindings without deleting or masking financial storage',()=>{
  assert.deepEqual([taskWorkspaceBindings.productId,taskWorkspaceBindings.workId,taskWorkspaceBindings.assigneeId],[{not:null},{not:null},{not:null}]);
  assert.equal('title' in taskWorkspaceBindings,false);assert.equal('legacyTable' in taskWorkspaceBindings,false);
});
test('frozen amount never waives a real live Work Product binding',()=>{
  const project={deletedAt:null},product={deletedAt:null,project};
  const row:FixtureRow={productId:'p',workId:'w',assigneeId:'u',allocationGroupId:'old',shareAmount:'17.89',work:{productId:'p',priceSnapshot:null,product,project}};
  assert.equal(matches(row,taskWorkspaceBindings as FixtureRow),true);
  for(const work of [{...row.work as FixtureRow,productId:null},{...row.work as FixtureRow,product:null},{...row.work as FixtureRow,product:{...product,deletedAt:new Date(0)}},{...row.work as FixtureRow,project:{deletedAt:new Date(0)}}])assert.equal(matches({...row,work},taskWorkspaceBindings as FixtureRow),false);
  assert.equal(row.shareAmount,'17.89');
});
test('coordinate eligibility binds task/work/product without changing historical facts; an empty area denies',async()=>{
  const project:FixtureRow={id:'project',deletedAt:null};
  const product:FixtureRow={id:'product',projectId:'project',project,deletedAt:null,tasks:[]};
  const work:FixtureRow={id:'work',projectId:'project',productId:'product',project,product,priceSnapshot:'0'};
  const task:FixtureRow={id:'task',projectId:'project',productId:'product',workId:'work',assigneeId:'user',work,product,project,allocationGroupId:'old',shareAmount:'17.89'};
  product.tasks=[task];
  const db={product:{findMany:async(args:Parameters<typeof queryRows>[1])=>queryRows([product],args)}} as unknown as Pick<PrismaClient,'product'>;
  const result=await taskWorkspaceEligibility(db,{projectId:'project',productId:'product'});
  assert.equal(matches(task,result as FixtureRow),true);
  for(const changed of [{...task,projectId:'elsewhere'},{...task,productId:'elsewhere'},{...task,work:{...work,projectId:'elsewhere'}},{...task,work:{...work,productId:'elsewhere'}},{...task,product:{...product,projectId:'elsewhere'}}])assert.equal(matches(changed,result as FixtureRow),false);
  assert.equal(task.shareAmount,'17.89');assert.equal(work.priceSnapshot,'0');
  const absent=await taskWorkspaceEligibility(db,{projectId:'absent'});assert.equal(matches(task,absent as FixtureRow),false);
});

// Источник: scoped-task-workspace.test.ts
function fixture(foreignCount=1){
 const projects:FixtureRow[]=[{id:"j",deletedAt:null},{id:"foreign-j",deletedAt:null}];
 const products:FixtureRow[]=[{id:"p",number:"101.1",projectId:"j",project:projects[0],deletedAt:null,tasks:[]},{id:"foreign-p",number:"999.1",projectId:"foreign-j",project:projects[1],deletedAt:null,tasks:[]}];
 const works:FixtureRow[]=products.map((product,index)=>({id:index?"foreign-w":"w",projectId:product.projectId,productId:product.id,project:product.project,product,priceSnapshot:"0"}));
 const tasks:FixtureRow[]=[{id:"own",projectId:"j",productId:"p",workId:"w",assigneeId:"worker",project:projects[0],product:products[0],work:works[0],status:"NEW",title:"Изделие"},...Array.from({length:foreignCount},(_,index)=>({id:"foreign-"+index,projectId:"foreign-j",productId:"foreign-p",workId:"foreign-w",assigneeId:"other",project:projects[1],product:products[1],work:works[1],status:"NEW",title:"Другая задача"}))];
 const observations:{model:string;args:unknown;rows:number}[]=[];
 const db={product:{findMany:async(args:Parameters<typeof queryRows>[1])=>{const rows=queryRows(products,args);observations.push({model:"product",args,rows:rows.length});return rows;}},$queryRaw:async(_strings:TemplateStringsArray,...parameters:unknown[])=>{
  const rows=tasks.filter(task=>{const work=task.work as FixtureRow|null,product=task.product as FixtureRow|null,project=task.project as FixtureRow|null;return work&&product&&project&&task.assigneeId!=null&&work.projectId===task.projectId&&work.productId===task.productId&&product.projectId===task.projectId&&product.deletedAt==null&&project.deletedAt==null&&(work.priceSnapshot!=null||task.allocationGroupId!=null&&task.shareAmount!=null)&&(!parameters[0]||task.projectId===parameters[0])&&(!parameters[2]||task.productId===parameters[2]);}).map(task=>({id:task.id}));
  observations.push({model:"legacy-task-ids",args:parameters,rows:rows.length});return rows;
 }} as unknown as Parameters<typeof taskWorkspaceEligibility>[0];
 const add=(task:FixtureRow)=>{tasks.push(task);for(const product of products)product.tasks=tasks.filter(row=>row.productId===product.id);};
 for(const product of products)product.tasks=tasks.filter(row=>row.productId===product.id);
 return{db,tasks,products,works,projects,observations,add};
}
test("scoped eligibility reads current product coordinates and no Task ID array as foreign tasks grow",async()=>{
 const results=[];
 for(const foreign of [1,10000]){const f=fixture(foreign),where=await taskWorkspaceEligibility(f.db,{projectId:"j",productId:"p"});
  results.push({foreign,ids:f.tasks.filter(row=>matches(row,where as FixtureRow)).map(row=>row.id),legacy:f.observations.filter(row=>row.model==="legacy-task-ids").length,coordinates:f.observations.filter(row=>row.model==="product").reduce((count,row)=>count+row.rows,0),foreignIds:JSON.stringify(where).includes("foreign-")});
 }
 assert.deepEqual(results.map(row=>row.ids),[["own"],["own"]]);
 assert.deepEqual(results.map(row=>row.legacy),[0,0]);
 assert.deepEqual(results.map(row=>row.coordinates),[1,1]);
 assert.deepEqual(results.map(row=>row.foreignIds),[false,false]);
});
test("absent, empty and ambiguous scopes deny before any eligibility read",async()=>{
 for(const scope of [undefined,{}, {projectIds:[]},{projectId:""},{productKey:""},{projectId:"j",productKey:"101.1"}]){
  const f=fixture(),where=await Reflect.apply(taskWorkspaceEligibility,undefined,[f.db,scope]);
  assert.equal(f.observations.length,0);assert.equal(f.tasks.some(row=>matches(row,where as FixtureRow)),false);
 }
});
test("product id-or-number and selected-project predicates preserve result without foreign coordinates",async()=>{
 for(const scope of [{productKey:"p"},{productKey:"101.1"},{projectIds:["j"]}]){
  const f=fixture(),where=await Reflect.apply(taskWorkspaceEligibility,undefined,[f.db,scope]);
  assert.deepEqual(f.tasks.filter(row=>matches(row,where as FixtureRow)).map(row=>row.id),["own"]);
  assert.deepEqual(f.observations.filter(row=>row.model==="product").map(row=>row.rows),[1]);
 }
});
test("priced zero and frozen share keep their bindings while orphan, cross relations and deleted rows stay hidden",async()=>{
 const f=fixture(),base=f.tasks[0],work=f.works[0];
 f.add({...base,id:"frozen",allocationGroupId:"old",shareAmount:"17.89",work:{...work,priceSnapshot:null}});
 for(const[patch,index]of [{productId:null,product:null},{workId:null,work:null},{work:{...work,projectId:"foreign-j"}},{work:{...work,productId:"foreign-p"}},{product:{...f.products[0],projectId:"foreign-j"}},{work:{...work,priceSnapshot:null},allocationGroupId:"old",shareAmount:null}].map((value,index)=>[value,index]as const))f.add({...base,...patch,id:"invalid-"+index});
 const before=f.tasks.map(row=>({id:row.id,shareAmount:row.shareAmount})),where=await taskWorkspaceEligibility(f.db,{projectId:"j"});
 assert.deepEqual(f.tasks.filter(row=>matches(row,where as FixtureRow)).map(row=>row.id),["own","frozen"]);
 assert.deepEqual(f.tasks.map(row=>({id:row.id,shareAmount:row.shareAmount})),before);
 assert.equal(taskReward({quantity:"1",executorShare:"1"},"0","BYN").rewardAmount,"0.00");
 f.products[0].deletedAt=new Date(0);assert.equal(f.tasks.some(row=>matches(row,where as FixtureRow)),false);
});

// Источник: work-coordinator-create-seam.test.ts
test("coordinator engineer creates on own visible PRODUCTION, without edit/execution, and stale removal denies", async () => {
  let currentRoles: Role[] = ["ENGINEER", "WORK_COORDINATOR"];
  const actor = { id: "engineer", name: "Инженер", roles: [...currentRoles], source: "web" as const };
  const project = { id: "project", number: "121", currency: "BYN", deletedAt: null, products: [], tasks: [] };
  const product = { id: "product", projectId: project.id, project, quantity: 2, engineerId: actor.id,
    status: "PRODUCTION", deletedAt: null, tasks: [] };
  const price = { id: "tariff", name: "Сборка", unit: "шт.", price: new Prisma.Decimal("50"), active: true };
  const works: FixtureRow[] = [], logs: FixtureRow[] = [];
  const db = {
    $queryRaw: async () => [],
    user: { findUnique: async () => ({ id: actor.id, name: actor.name, active: true, roles: currentRoles }) },
    task: { findMany: async () => [] },
    productPercentageParticipant: { findMany: async () => [] },
    project: { findUnique: async ({ where }: { where: FixtureRow }) => matches(project, where) ? project : null },
    product: { findFirst: async ({ where }: { where: FixtureRow }) => matches(product, where) ? product : null },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    priceItem: { findUnique: async () => price, findMany: async () => [price] },
    work: { create: async ({ data }: { data: FixtureRow }) => { const row = { id: `work-${works.length}`, ...data }; works.push(row); return row; } },
    changeLog: { create: async ({ data }: { data: FixtureRow }) => { logs.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const input = { projectId: project.id, productId: product.id, priceItemId: price.id, quantityPerUnit: 1 };
  const created = await addWorkCore(actor, input, callback => callback(db));
  assert.ok(created.ok, created.ok ? undefined : created.error);
  assert.equal(works.length, 1);
  assert.equal(String(works[0].priceSnapshot), "50");
  assert.equal(new Prisma.Decimal(String(works[0].total)).equals("100"), true);
  assert.equal(canCreateOrdinaryWork(actor.roles), true);
  assert.equal(canAddProductWork(actor.roles, product.status), true, "The visible product enables the create button");
  assert.equal((await listWorkPriceOptions(actor, product.id, db)).length, 1);
  assert.equal(canEditOrdinaryWork(actor.roles, product.status), false);
  assert.equal(matches({ id: "ordinary-task", assigneeId: actor.id, productId: product.id, product, project }, taskExecutionWhere(actor)), false);
  product.engineerId = "other";
  assert.equal((await addWorkCore(actor, input, callback => callback(db))).ok, false, "Knowing a foreign product ID never grants creation");
  product.engineerId = actor.id;
  currentRoles = ["ENGINEER"];
  assert.equal((await addWorkCore(actor, input, callback => callback(db))).ok, false, "The transaction uses current roles after addon removal");
  assert.deepEqual(await listWorkPriceOptions(actor, product.id, db), []);
  assert.equal(works.length, 1);
  assert.equal(logs.length, 1);
});

{ // Источник: procurement-access.test.ts
type Role=role.Role;
const procurement='PROCUREMENT' as Role;
test('financial and warehouse/office grants remain independent of manager privileges',()=>{
 const sets=role as unknown as Record<string,Role[]>;
 const cases:[Role[],boolean,boolean,boolean,boolean][]=[
  [[procurement],true,true,true,false], [['ACCOUNTANT'],true,false,false,false], [['MANAGER'],false,true,true,true], [['WORKER'],false,false,false,false],
  [['ACCOUNTANT','ENGINEER'],true,true,false,false], [['ACCOUNTANT','MANAGER'],true,true,true,true], [[procurement,'MANAGER'],true,true,true,true],
 ];
 for(const [roles,finance,office,warehouse,manager] of cases){assert.equal(role.hasAnyRole(roles,role.FINANCE_ROLES),finance);assert.equal(role.hasAnyRole(roles,role.OFFICE_ROLES),office);assert.equal(role.hasAnyRole(roles,sets.WAREHOUSE_MANAGE_ROLES??[]),warehouse);assert.equal(role.hasAnyRole(roles,role.MANAGER_ROLES),manager);assert.equal(role.hasAnyRole(roles,role.ADVANCE_ROLES),finance);}
 assert.equal(role.roleLabels[procurement],'Снабженец');assert.equal(role.isValidRolesCombination(['ADMIN',procurement]),false);assert.equal(role.isValidRolesCombination(['DIRECTOR',procurement]),false);assert.equal(role.isValidRolesCombination(['ACCOUNTANT',procurement]),true);
});
test('pure accountant has no operational read/task execution; role union preserves independent engineering/field grants',()=>{
 const acc={id:'a',roles:['ACCOUNTANT'] as Role[]};assert.equal(hasFullProjectVisibility(acc),false);assert.match(JSON.stringify(productVisibilityWhere(acc)),/"in":\[\]/);assert.match(JSON.stringify(fileVisibilityWhere(acc)),/"in":\[\]/);assert.doesNotMatch(JSON.stringify(taskExecutionWhere(acc)),/"assigneeId":"a"/);assert.notEqual(taskRecipientError({...acc,active:true},null),null);
 assert.equal(hasFullProjectVisibility({id:'a',roles:['ACCOUNTANT','ENGINEER']}),false);assert.match(JSON.stringify(taskExecutionWhere({id:'a',roles:['ACCOUNTANT','WORKER']})),/"assigneeId":"a"/);
 assert.equal(hasFullProjectVisibility({id:'p',roles:[procurement]}),true);for(const status of ['DRAFT','PREPARATION','DESIGN','PRODUCTION'])assert.equal(matches({id:'p',status,engineerId:'p',deletedAt:null,project:{deletedAt:null}},productEditWhere({id:'p',roles:[procurement]})),false,status);
});
test('home and navigation isolate finance-only accountant and pure manager advance denial',()=>{
 const accountant=navItemsForRole(['ACCOUNTANT']).map(item=>item.href);for(const path of ['/projects','/products','/clients','/tasks','/warehouse','/prices','/my'])assert.ok(!accountant.includes(path));assert.ok(accountant.includes('/finance'));
 assert.equal(homePathForRoles([procurement]),'/warehouse');assert.ok(navItemsForRole([procurement]).some(item=>item.href==='/finance'));assert.ok(!navItemsForRole(['MANAGER']).some(item=>item.href==='/advances'));
});
test('actual auth route callback rejects operational HTTP routes for accountant, permits finance and union grants',async()=>{
 const authorize=(roles:Role[],pathname:string)=>authConfig.callbacks.authorized({auth:{user:{id:'actor',roles}},request:{nextUrl:new URL(`https://qa.invalid${pathname}`)}} as never);
 for(const path of ['/projects','/products/id','/clients','/tasks','/warehouse/items','/prices','/my','/api/files/id','/payroll'])assert.ok((await authorize(['ACCOUNTANT'],path)) instanceof Response,path);
 assert.equal(await authorize(['ACCOUNTANT'],'/finance/payroll'),true);assert.equal(await authorize(['ACCOUNTANT','ENGINEER'],'/payroll'),true);assert.equal(await authorize(['ACCOUNTANT','MANAGER'],'/payroll'),true);
 assert.equal(await authorize(['ACCOUNTANT'],'/finance'),true);assert.equal(await authorize([procurement],'/products/id'),true);assert.equal(await authorize(['ACCOUNTANT','MANAGER'],'/projects'),true);assert.ok((await authorize(['MANAGER'],'/advances')) instanceof Response);
});
}

// Источник: procurement-privacy.test.ts
test('old operational notifications are filtered for pure accountant before content projection',async()=>{
 const items=['file.added','task.assigned','product.statusChanged','payment.added','payroll.payout'].map(type=>({type,title:'Private title',body:'Private body',link:'/products/p'}));
 const db={product:{findFirst:async()=>null},project:{findFirst:async()=>null},task:{findFirst:async()=>null}};
 const result=await scopeNotificationContent({id:'a',roles:['ACCOUNTANT']},items,db as never);
 assert.deepEqual(result.map(item=>item.type),['payment.added','payroll.payout']);assert.equal(result[0].link,'/finance');assert.equal(result[1].body,'Private body');
 assert.equal(receivableTypesFor(['ACCOUNTANT']).some(item=>item.id==='task.assigned'),false);
});
test('manager receives project commerce and own payroll but no global financial bodies; union restores finance',()=>{
 for(const type of ['payment.added','expense.added','payroll.orgAccrued','payroll.orgPayout']){assert.equal(canReceiveNotificationContent(['MANAGER'],type),false);assert.equal(orgRolesFor(type).includes('MANAGER'),false);assert.equal(canReceiveNotificationContent(['MANAGER','ACCOUNTANT'],type),true);}
 assert.equal(canReceiveNotificationContent(['MANAGER'],'project.created'),true);assert.equal(canReceiveNotificationContent(['MANAGER'],'payroll.payout'),true);assert.equal(canReceiveNotificationContent(['PROCUREMENT'],'file.added'),true);
});
test('bot financial channel does not grant operational manager writes',()=>{
 for(const roles of [['ACCOUNTANT'],['PROCUREMENT']] as const){const actor={id:'a',name:'A',source:'telegram' as const,roles:[...roles]};assert.equal(botAllowed(actor.roles),true);assert.equal(requireBotFinance(actor),null);assert.equal(requireBotManager(actor)?.status,403);}
 assert.equal(requireBotFinance({id:'m',name:'M',source:'telegram',roles:['MANAGER']})?.status,403);
});

// Источник: product-payment-privacy.test.ts
test("стоимость назначенного изделия скрывается у всех трёх исполнителей",async()=>{
 const fixture=engineerFixture();
 for(const roles of [["ENGINEER"],["WORKER"],["MOUNTER"],["ENGINEER","WORKER"]] as Role[][]){
  const row=fixture.products[0] as {id:string;expectedPrice:unknown;initialPrice?:unknown};
  const masked=await maskProductionRead(fixture.db as unknown as PrismaClient,{id:"engineer",roles},[row]);
  assert.equal(masked[0].expectedPrice,null);
  assert.equal(masked[0].initialPrice,null);
  assert.equal(row.expectedPrice,100,"исходные данные нельзя менять");
 }
});

test("полевые роли видят свою матрицу стадий, без подготовки, права записи или чужой задачи",()=>{
 const fixture=engineerFixture(),row=fixture.products[2];
 for(const role of ["WORKER","MOUNTER"] as const){
  const actor={id:"unassigned",roles:[role]};
  const allowed=role==="WORKER"?["PRODUCTION","STORAGE"]:["INSTALLATION"];
  for(const status of ["PRODUCTION","STORAGE","INSTALLATION","DONE","RECLAMATION"]){row.status=status;assert.equal(matches(row,productVisibilityWhere(actor)),allowed.includes(status),role+":"+status);assert.equal(matches(row,productEditWhere(actor)),false);}
  row.status="PREPARATION";assert.equal(matches(row,productVisibilityWhere(actor)),false);
  row.status="DESIGN";assert.equal(matches(row,productVisibilityWhere(actor)),false);
  assert.equal(fixture.tasks.some(task=>matches(task,taskExecutionWhere(actor))),false);
  assert.ok(navItemsForRole([role]).some(item=>item.href==="/products"));
 }
});

test("историческая сумма не раскрывается прежнему исполнителю в карточке нового получателя",async()=>{
 const product={id:"p",quantity:3,expectedPrice:"1000",project:{currency:"BYN"},noModel:false,files:[],stagePayPools:[],engineerId:null,engineer:null,assemblerId:"current",assembler:{name:"Новый сборщик",active:true,roles:["WORKER"]},mounterId:null,mounter:null,
  percentageConfigs:[{kind:"ASSEMBLY",ratePercent:"6",revision:2}],
  percentageCompletions:[{kind:"ASSEMBLY",state:"SETTLED",amount:"150",priceSnapshot:"1000",quantitySnapshot:3,ratePercentSnapshot:"5",productCurrency:"BYN",payrollCurrency:"BYN",calculationVersion:4,shares:[{userId:"previous",userNameSnapshot:"Прежний сборщик",shareUnits:1000000,amount:"150",adjustments:[]}]}]};
 const database={task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},product:{findFirst:async()=>product},user:{findMany:async()=>[]},payrollEntry:{findMany:async()=>[]}} as unknown as Parameters<typeof getProductPercentageView>[2];
 const old=await getProductPercentageView({id:"previous",roles:["WORKER"]},"p",database);
 assert.equal(old.sections.ASSEMBLY.ownMember,null);assert.equal(old.sections.ASSEMBLY.total,null);assert.deepEqual(old.sections.ASSEMBLY.members,[]);
 const current=await getProductPercentageView({id:"current",roles:["WORKER"]},"p",database);
 assert.equal(current.sections.ASSEMBLY.total,"180.00");
 for(const field of ["price","unitPrice","productTotal","ratePercent","currentRatePercent"] as const)assert.equal(current.sections.ASSEMBLY[field],null);
});

test("защищённый старый инженерный пул не скрывает текущий прогноз выбранного инженера",async()=>{
 const product={id:"p",quantity:3,expectedPrice:"1000",project:{currency:"BYN"},noModel:false,files:[],stagePayPools:[{state:"SETTLED",settlement:null}],percentageCompletions:[],engineerId:"eng",engineer:{name:"Инженер",active:true,roles:["ENGINEER"]},assemblerId:null,assembler:null,mounterId:null,mounter:null,percentageConfigs:[{kind:"ENGINEERING",ratePercent:"6",revision:2}]};
 const database={task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},product:{findFirst:async()=>product},user:{findMany:async()=>[]},payrollEntry:{findMany:async()=>[]}} as unknown as Parameters<typeof getProductPercentageView>[2];
 const own=await getProductPercentageView({id:"eng",roles:["ENGINEER"]},"p",database),manager=await getProductPercentageView({id:"manager",roles:["MANAGER"]},"p",database);
 assert.equal(own.sections.ENGINEERING.total,"60.00");assert.equal(manager.sections.ENGINEERING.total,"60.00");
 assert.equal(own.sections.ENGINEERING.ratePercent,null);assert.equal(own.sections.ENGINEERING.price,null);
});
