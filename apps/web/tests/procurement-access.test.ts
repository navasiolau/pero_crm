import {liveProductWhere} from "../src/server/access/live-entities";
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as role from '../src/lib/roles';
import {homePathForRoles} from '../src/lib/home-route';
import {navItemsForRole} from '../src/lib/nav';
import {hasFullProjectVisibility,productVisibilityWhere,productEditWhere,taskExecutionWhere,fileVisibilityWhere} from '../src/server/access/visibility';
import {taskRecipientError} from '../src/server/tasks/share-policy';
import {authConfig} from '../src/auth.config';
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
 assert.equal(hasFullProjectVisibility({id:'p',roles:[procurement]}),true);assert.deepEqual(productEditWhere({id:'p',roles:[procurement]}),{AND:[liveProductWhere,{AND:[liveProductWhere,{id:{in:[]}}]}]});
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
