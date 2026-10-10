import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PrismaClient,Role} from '@prisma/client';
import {resolveUploadContext} from '../src/server/files/upload-context';
import {fixtureModel,type FixtureRow} from './helpers/visibility-fixture';
function fixture(assigneeId:string){const project:FixtureRow={id:'j',number:'1',products:[],tasks:[]};const product:FixtureRow={id:'p',number:'1.1',projectId:'j',project,engineerId:'e',status:'DESIGN',tasks:[]};const task:FixtureRow={id:'t',projectId:'j',project,productId:'p',product,assigneeId,status:'NEW',work:null};project.products=[product];project.tasks=[task];product.tasks=[task];return{project,product,task,db:{project:fixtureModel([project]),product:fixtureModel([product]),task:fixtureModel([task]),productPercentageParticipant:fixtureModel([])} as unknown as PrismaClient};}
const context={projectId:'j',productId:'p',taskId:null};
test('read-only accountant without an execution assignment has no upload capability',async()=>{const f=fixture('worker');assert.equal(await resolveUploadContext(f.db,{id:'accountant',roles:['ACCOUNTANT']},context),null)});
test('actual assigned field roles retain upload access on their visible status and manager union retains full grant',async()=>{for(const roles of [['WORKER'],['MOUNTER'],['ENGINEER','WORKER'],['MANAGER','ENGINEER']] as Role[][]){const f=fixture('worker');f.product.status=roles.length===1&&roles.includes('MOUNTER')?'INSTALLATION':'PRODUCTION';assert.ok(await resolveUploadContext(f.db,{id:'worker',roles},context));}});
test('pure engineer only uploads own DESIGN product and task/product mismatch is rejected',async()=>{const f=fixture('worker');assert.ok(await resolveUploadContext(f.db,{id:'e',roles:['ENGINEER']},context));f.product.status='PRODUCTION';assert.equal(await resolveUploadContext(f.db,{id:'e',roles:['ENGINEER']},context),null);assert.equal(await resolveUploadContext(f.db,{id:'m',roles:['MANAGER']},{...context,productId:'foreign',taskId:'t'}),null)});

test('historical accountant assignment cannot grant upload; independent field union still can',async()=>{const f=fixture('accountant');assert.equal(await resolveUploadContext(f.db,{id:'accountant',roles:['ACCOUNTANT']},context),null);f.product.status='PRODUCTION';assert.ok(await resolveUploadContext(f.db,{id:'accountant',roles:['ACCOUNTANT','WORKER']},context));});
