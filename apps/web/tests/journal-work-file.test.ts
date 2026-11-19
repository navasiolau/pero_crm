import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Prisma,type PayrollEntry} from '@prisma/client';
import {persistOrdinaryUpload} from '../src/server/files/upload-core';
import {splitTaskPayroll} from '../src/server/tasks/task-payroll-transfer';
import {parseJournalPresentation} from '../src/server/changelog/presentation';
import {operationJournalContext} from '../src/server/tasks/journal';
import {deleteTaskInTransaction} from '../src/server/tasks/delete-core';
import {deleteProductSketchCore} from '../src/server/products/cover-core';
import {deleteProjectCoverCore} from '../src/server/projects/cover-core';
import {transferPieceworkShareCore} from '../src/server/tasks/piecework-core';
import {taskShareFixture} from './helpers/task-share-fixture';

test('загрузка хранит полные метаданные и product контекст, повтор сохраняет исходный receipt',async()=>{
  const logs:Record<string,unknown>[]=[];
  let file:Record<string,unknown>|null=null;
  const tx={$queryRaw:async()=>[],file:{create:async({data}:{data:Record<string,unknown>})=>(file={id:'file',...data}),findUnique:async()=>file},
    changeLog:{findUnique:async()=>logs[0]??null,create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data;}}} as unknown as Prisma.TransactionClient;
  const input={clientMutationId:randomUUID(),fingerprint:'upload-fingerprint',projectNumber:'203',data:{projectId:'project',productId:'product',taskId:null,
    fileName:'Полное длинное имя '.repeat(6)+'.b3d',storedName:'qa.b3d',mimeType:'application/octet-stream',size:12345,section:'PRODUCTION' as const,hasThumb:false,uploadedById:'actor'}};
  await persistOrdinaryUpload(tx,{id:'actor',name:'Пользователь'},input);
  const view=parseJournalPresentation(logs[0].presentation);assert.ok(view);
  assert.deepEqual(view.contexts.map(({kind,id})=>({kind,id})),[{kind:'product',id:'product'}]);
  assert.ok(JSON.stringify(view.changes).includes(input.data.fileName));
  assert.ok(JSON.stringify(view.changes).includes('12345'));
  const raw=structuredClone(logs[0].newValue);
  const repeated=await persistOrdinaryUpload(tx,{id:'actor',name:'Пользователь'},input);
  assert.equal(repeated.repeated,true);assert.equal(logs.length,1);assert.deepEqual(logs[0].newValue,raw);
});

test('разделение начисления показывает обе суммы и System, сохраняя raw parent receipt',async()=>{
  const entry={id:'payroll',userId:'first',taskId:'task',workId:'work',projectId:'project',productId:'product',amount:new Prisma.Decimal(100),
    bynAmount:new Prisma.Decimal(100),projectAmount:new Prisma.Decimal(100),currency:'BYN',projectCurrency:'BYN',scheme:'PIECE',month:'2026-11',comment:'Задача'} as PayrollEntry;
  const logs:Record<string,unknown>[]=[];
  const tx={$queryRaw:async()=>[],payrollEntry:{update:async({data}:{data:object})=>({...entry,...data}),
    create:async({data}:{data:object})=>({...entry,id:'child-payroll',...data})},changeLog:{create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data;}}} as unknown as Prisma.TransactionClient;
  await splitTaskPayroll(tx,{id:'actor',name:'Руководитель',roles:['ADMIN'],source:'web'},[entry],'second','child-task','25',randomUUID());
  assert.equal(logs.length,1);
  const view=parseJournalPresentation(logs[0].presentation);assert.ok(view);
  assert.equal(view.actor.type,'system');assert.equal(view.initiator?.id,'actor');
  assert.deepEqual(view.contexts.map(({kind,id})=>({kind,id})),[{kind:'product',id:'product'}]);
  const values=JSON.stringify(view.changes);assert.ok(values.includes('75.00'));assert.ok(values.includes('25.00'));
  const raw=logs[0].newValue as Record<string,unknown>;assert.equal(raw.amount,'75.00');assert.equal(raw.childEntryId,'child-payroll');
});

test('контексты переноса включают обоих владельцев, обычное изделие не получает project ленту',async()=>{
  const tx={$queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>strings.join('').includes('FROM "Product"')?[{id:values[0],number:values[0]==='new'?'203.2':'203.1'}]:[] } as unknown as Prisma.TransactionClient;
  const entity={type:'task',id:'task',label:'Задача'};
  const moved=await operationJournalContext(tx,entity,[{projectId:'project',projectNumber:'203',productId:null},
    {projectId:'project',projectNumber:'203',productId:'new',product:{id:'old',number:'203.1'}}]);
  assert.deepEqual(moved.contexts?.map(({kind,id})=>({kind,id})),[{kind:'project',id:'project'},{kind:'product',id:'new'}]);
  assert.equal(moved.contexts?.[1].label,'Изделие 203.2');
  const ordinary=await operationJournalContext(tx,entity,[{projectId:'project',projectNumber:'203',productId:'new'}]);
  assert.deepEqual(ordinary.contexts?.map(({kind,id})=>({kind,id})),[{kind:'product',id:'new'}]);
  assert.ok(ordinary.links?.some(link=>link.type==='project'));
});

test('удаление задачи атомарно с file detach аудитом и откатывается при отказе журнала',async()=>{
  const task={id:'task',title:'Удаляемая задача',type:'Производство',projectId:'project',productId:'product',workId:null,assigneeId:'employee-id',status:'NEW',
    allocationGroupId:null,project:{id:'project',number:'203'},product:{id:'product',number:'203.1'},work:null,dependencies:[],_count:{payrollEntries:0,timeEntries:0}};
  const state={task:structuredClone(task) as typeof task|null,files:[{id:'file',fileName:'Файл задачи.b3d',mimeType:'application/octet-stream',size:123,section:'PRODUCTION',projectId:'project',productId:null,taskId:'task' as string|null,uploadedById:'actor'}],logs:[] as Record<string,unknown>[]};
  let failAudit=true;
  const tx={$queryRaw:async(query:TemplateStringsArray|Prisma.Sql)=>{const text=Array.isArray(query)?query.join(''):(query as Prisma.Sql).strings.join('');
    if(text.includes('FROM "User"'))return[{id:'employee-id',name:'Исполнитель до удаления'}];
    return text.includes('FROM "Task" WHERE id=')&&state.task?[structuredClone(state.task)]:[];},
    task:{findUnique:async()=>structuredClone(state.task),delete:async()=>{state.task=null;}},taskDependency:{deleteMany:async()=>({count:0})},
    file:{findMany:async()=>structuredClone(state.files),updateMany:async()=>{state.files.forEach(file=>{file.taskId=null;});return{count:state.files.length};}},
    changeLog:{create:async({data}:{data:Record<string,unknown>})=>{if(failAudit)throw Error('AUDIT_FAILED');state.logs.push(data);return data;}}} as unknown as Prisma.TransactionClient;
  const actor={id:'actor',name:'Администратор',roles:['ADMIN' as const],source:'web' as const};
  const run=async()=>{const before=structuredClone(state);try{return await deleteTaskInTransaction(tx,actor,'task');}catch(error){Object.assign(state,before);throw error;}};
  const before=structuredClone(state);await assert.rejects(run,/AUDIT_FAILED/);assert.deepEqual(state,before);
  failAudit=false;assert.equal((await run()).ok,true);assert.equal(state.task,null);assert.equal(state.files[0].taskId,null);assert.equal(state.logs.length,2);
  const detach=state.logs.find(log=>log.entity==='file')!,view=parseJournalPresentation(detach.presentation);assert.equal(view?.actor.type,'system');
  assert.deepEqual(view?.contexts.map(({kind,id})=>({kind,id})),[{kind:'product',id:'product'},{kind:'project',id:'project'}]);
  const deletedView=parseJournalPresentation(state.logs.find(log=>log.entity==='task')!.presentation);
  assert.equal(deletedView?.changes.find(change=>change.path==='assigneeId')?.before,'Исполнитель до удаления');
  const count=state.logs.length;assert.equal((await run()).ok,false);assert.equal(state.logs.length,count);
});

test('split журналирует добавленный blocker у другого изделия и общей задачи, replay не дублирует события',async()=>{
  const f=taskShareFixture();
  f.state().products.push({id:'other-product',projectId:'project',number:'1.2',engineerId:null,status:'PRODUCTION'});
  const dependent=f.state().tasks.find(task=>task.id==='dependent')!;
  Object.assign(dependent,{productId:'other-product',title:'Зависимая задача другого изделия'});
  f.state().tasks.push({...dependent,id:'common-dependent',productId:null,title:'Общепроектная зависимая задача'});
  f.state().dependencies.push({taskId:'common-dependent',dependsOnId:'source'},{taskId:'dependent',dependsOnId:'predecessor'});
  const input={taskId:'source',recipientId:'recipient',percent:'30',expectedRevision:0,clientMutationId:randomUUID()};
  const actor={id:'worker',name:'Исполнитель',roles:['WORKER' as const],source:'web' as const};
  const result=await transferPieceworkShareCore(actor,input,f.transaction);assert.equal(result.ok,true);if(!result.ok)return;
  const childId=result.taskIds[1];
  for(const [id,kind,owner] of [['dependent','product','other-product'],['common-dependent','project','project']] as const){
    const log=f.state().logs.find(log=>log.entity==='task'&&log.entityId===id&&log.field==='dependencyIds');
    assert.ok(log,'Каждая изменённая зависимая задача должна иметь событие');
    const old=id==='dependent'?['predecessor','source']:['source'];
    assert.deepEqual(log.oldValue,{dependencyIds:old});assert.deepEqual(log.newValue,{dependencyIds:[...old,childId].sort()});
    const view=parseJournalPresentation(log.presentation);assert.equal(view?.actor.type,'system');assert.equal(view?.initiator?.id,'worker');
    assert.deepEqual(view?.contexts.map(({kind,id})=>({kind,id})),[{kind,id:owner}]);
  }
  const before=structuredClone(f.state());const replay=await transferPieceworkShareCore(actor,input,f.transaction);
  assert.equal(replay.ok,true);assert.deepEqual(f.state(),before);
  assert.equal(f.state().tasks.find(task=>task.id==='source')!.shareAmount,'700.00');
  assert.equal(f.state().tasks.find(task=>task.id===childId)!.shareAmount,'300.00');
});

test('оба cover-delete caller передают полные тип, размер и раздел файла в общий audit',async()=>{
  for(const kind of ['project','product'] as const){
    const logs:Record<string,unknown>[]=[];
    const file={id:'file',projectId:'project',productId:kind==='product'?'product':null,taskId:null,fileName:'Полная обложка.png',storedName:'cover.png',mimeType:'image/png',size:789,section:kind==='product'?'PRODUCTION':'GENERAL',uploadedById:'actor',hasThumb:false};
    const project={id:'project',number:'203',stage:'CONTRACT',coverFileId:'file',deletedAt:null};
    const product={id:'product',number:'203.1',projectId:'project',project,status:'DESIGN',engineerId:null,sketchFileId:'file',deletedAt:null,proposalItem:null};
    const tx={$queryRaw:async(query:TemplateStringsArray|Prisma.Sql)=>{
      const text=Array.isArray(query)?query.join(''):(query as Prisma.Sql).strings.join('');
      if(text.includes('FROM "Product"'))return[product];if(text.includes('FROM "Project"'))return[project];if(text.includes('FROM "User"'))return[{id:'actor',name:'Менеджер'}];return[];
    },project:{findFirst:async()=>project,updateMany:async()=>({count:1})},product:{findFirst:async()=>product,updateMany:async()=>({count:1})},
      file:{findFirst:async()=>file,findUnique:async()=>file,update:async()=>file},domainEvent:{create:async()=>({id:'event'})},
      changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(log=>log.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data;}}} as unknown as Prisma.TransactionClient;
    const actor={id:'actor',name:'Менеджер',roles:['MANAGER' as const]},storage={mode:'s3' as const,endpoint:'https://fixture.invalid',bucket:'fixture'};
    const result=kind==='project'?await deleteProjectCoverCore(tx,actor,{projectId:'project',expectedCoverFileId:'file',clientMutationId:randomUUID()},storage):
      await deleteProductSketchCore(tx,actor,{productId:'product',expectedSketchFileId:'file',clientMutationId:randomUUID()},storage);
    assert.equal(result.ok,true,kind);
    const log=logs.find(log=>log.entity==='file'&&log.action==='delete');assert.ok(log);
    const view=parseJournalPresentation(log.presentation);assert.ok(view);
    assert.equal(view.changes.find(change=>change.path==='size')?.before,789);
    assert.equal(view.changes.find(change=>change.path==='mimeType')?.before,'image/png');
    assert.ok(view.changes.find(change=>change.path==='section')?.beforeKnown);
    assert.deepEqual(log.oldValue,{fileName:file.fileName});
  }
});
