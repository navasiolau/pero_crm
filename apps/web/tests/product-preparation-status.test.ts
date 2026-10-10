import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductStatus, Role } from '@prisma/client';
import { PRODUCT_STATUSES, productStatusLabels, productStatusStyles } from '../src/lib/product-statuses';
import { decideProductPercentageStatus, percentageCompletionKinds } from '../src/lib/product-percentage-status';
import { productVisibilityWhere, projectVisibilityWhere, taskVisibilityWhere, taskExecutionWhere, fileVisibilityWhere, productEditWhere, workVisibilityWhere } from '../src/server/access/visibility';
import { matches, type FixtureRow } from './helpers/visibility-fixture';

const preparation='PREPARATION' as ProductStatus;
test('preparation follows draft with label and neutral style',()=>{
 assert.equal(PRODUCT_STATUSES[0].id,'DRAFT');assert.equal(PRODUCT_STATUSES[1].id,preparation);assert.equal(PRODUCT_STATUSES[2].id,'DESIGN');
 assert.equal(productStatusLabels[preparation],'Подготовка');assert.ok(productStatusStyles[preparation]);
});

test('preparation denies product, project, tasks, execution, work and files for assigned field and engineering roles',()=>{
 for(const role of ['ENGINEER','WORKER','MOUNTER'] as Role[]){
 const actor={id:'assigned',roles:[role],engineeringParticipantProductIds:['p'],engineeringParticipantTaskIds:['t'],fieldParticipantProductIds:['p']};
 const product={id:'p',status:preparation,deletedAt:null,engineerId:'assigned',assemblerId:'assigned',assembler:{active:true,roles:['WORKER']},mounterId:'assigned',tasks:[{assigneeId:'assigned'}],project:{tasks:[{assigneeId:'assigned',productId:null}]}};
 const project={id:'project',deletedAt:null,products:[product],tasks:[{assigneeId:'assigned',productId:null}]};
 const task={id:'t',deletedAt:null,productId:'p',projectId:'project',assigneeId:'assigned',product,project};
 const file={deletedAt:null,productId:'p',taskId:null,product,project,task};
 const work={deletedAt:null,productId:'p',product,project,tasks:[task],paymentKind:'LEGACY',stagePayPoolId:null,poolWeightUnits:null};
 for(const [row,where] of [[product,productVisibilityWhere(actor)],[product,productEditWhere(actor)],[project,projectVisibilityWhere(actor)],[task,taskVisibilityWhere(actor)],[task,taskExecutionWhere(actor)],[file,fileVisibilityWhere(actor)],[work,workVisibilityWhere(actor)]])assert.equal(matches(row as FixtureRow,where as FixtureRow),false,`${role} ${JSON.stringify(where)}`);
 }
});

test('management can start preparation, engineering cannot and early transitions never accrue',()=>{
 const context={from:preparation,to:'DESIGN' as ProductStatus,assignedEngineer:true,participant:false,hasB3d:false,noModel:false};
 for(const roles of [['ADMIN'],['DIRECTOR'],['MANAGER'],['MANAGER','ENGINEER']] as Role[][])assert.equal(decideProductPercentageStatus(roles,context).allowed,true);
 for(const role of ['ENGINEER','WORKER','MOUNTER'] as Role[])assert.equal(decideProductPercentageStatus([role],context).allowed,false);
 assert.deepEqual(percentageCompletionKinds(preparation,'DESIGN',true),[]);
 assert.deepEqual(percentageCompletionKinds('DESIGN',preparation,true),[]);
 assert.deepEqual(percentageCompletionKinds(preparation,'PRODUCTION',true),['ENGINEERING']);
});

test('field visibility of existing subsequent statuses follows the role matrix',()=>{
 for(const status of ['PRODUCTION','STORAGE','INSTALLATION','DONE','RECLAMATION'] as ProductStatus[]){
 for(const role of ['WORKER','MOUNTER'] as Role[]){
 const actor={id:'worker',roles:[role]};
 const allowed=role==='WORKER'?status==='PRODUCTION'||status==='STORAGE':status==='INSTALLATION';
 assert.equal(matches({deletedAt:null,status,tasks:[],project:{tasks:[]}},productVisibilityWhere(actor) as FixtureRow),allowed,`${role} ${status}`);
 }
 }
});
