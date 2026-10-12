import assert from 'node:assert/strict';
import test from 'node:test';
import type {Role} from '@prisma/client';
import {authConfig} from '../src/auth.config';
import {createPaymentCore} from '../src/server/payments/service';
import {createProjectCore} from '../src/server/projects/core';
const actor=(roles:Role[])=>({id:'actor',name:'Actor',roles,source:'web' as const});
test('actual route policy admits finance workspace but keeps accountant outside general projects',()=>{
 const allow=(roles:Role[],pathname:string)=>authConfig.callbacks.authorized({auth:{user:{id:'actor',roles}},request:{nextUrl:new URL(`https://qa.invalid${pathname}`)}} as never);
 assert.equal(allow(['ACCOUNTANT'],'/finance/projects/205'),true);assert.equal(allow(['PROCUREMENT'],'/finance/projects/205'),true);assert.ok(allow(['ACCOUNTANT'],'/projects/205') instanceof Response);assert.ok(allow(['MANAGER'],'/finance/projects/205') instanceof Response);
});
test('reused real money/general creation entrypoints retain their independent role guards',async()=>{
 for(const roles of [['MANAGER'],['ENGINEER'],['WORKER']] as Role[][])await assert.rejects(createPaymentCore(actor(roles),{clientMutationId:'00000134-0000-4000-8000-000000000103',projectId:'j',direction:'INCOME',currency:'BYN',cashAccountId:'cash',amount:1}),/прав/);
 for(const roles of [['ACCOUNTANT'],['PROCUREMENT']] as Role[][])await assert.rejects(createProjectCore(actor(roles),{title:'Must not create',clientId:'client'}),/прав/);
});
