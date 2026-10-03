import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Role} from '@prisma/client';
import {canManageFinishCatalog,canReadFinishCatalog} from '../src/lib/finish-catalog-access';
import {canAccessOperationalPath} from '../src/lib/operational-access';
import {navItemsForRole} from '../src/lib/nav';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject('next/navigation',{useRouter:()=>({refresh(){throw Error('SSR_REFRESH_FORBIDDEN')}})});
inject('../src/server/finishes/actions',{createFinishAction(){throw Error('SSR_WRITE_FORBIDDEN')},updateFinishAction(){throw Error('SSR_WRITE_FORBIDDEN')},setFinishActiveAction(){throw Error('SSR_WRITE_FORBIDDEN')}});
Object.assign(globalThis,{React});
const{FinishesView}=require('../src/app/(app)/finishes/finishes-view') as typeof import('../src/app/(app)/finishes/finishes-view');
const row={id:'11111111-1111-4111-8111-111111111111',kind:'ENAMEL' as const,name:'Белая эмаль',code:'RAL9016',color:'Белый',active:true,sampleAssetId:null,sampleAsset:null,revision:0,updatedAt:new Date(0).toISOString()};
test('exact management and operational readonly role unions retain their independent permissions',()=>{
 for(const roles of [['ADMIN'],['DIRECTOR'],['MANAGER'],['PROCUREMENT'],['ENGINEER','PROCUREMENT']] as Role[][]){assert.equal(canManageFinishCatalog(roles),true);assert.equal(canReadFinishCatalog(roles),true);assert.ok(navItemsForRole(roles).some(item=>item.href==='/finishes'));}
 for(const roles of [['ENGINEER'],['WORKER'],['MOUNTER']] as Role[][]){assert.equal(canReadFinishCatalog(roles),true);assert.equal(canManageFinishCatalog(roles),false);}
 for(const roles of [['ACCOUNTANT'],[]] as Role[][]){assert.equal(canReadFinishCatalog(roles),false);assert.equal(canAccessOperationalPath(roles,'/finishes'),false);assert.equal(canManageFinishCatalog(roles),false);}
});
test('actual catalog SSR shows readonly row values without any management commands',()=>{
 const readonly=renderToStaticMarkup(React.createElement(FinishesView,{rows:[row],canManage:false}));for(const value of ['Белая эмаль','RAL9016','Белый'])assert.ok(readonly.includes(value));assert.doesNotMatch(readonly,/Добавить вариант|Отключить|Включить|Изменить/);const manager=renderToStaticMarkup(React.createElement(FinishesView,{rows:[row],canManage:true}));assert.match(manager,/Добавить вариант/);assert.match(manager,/Отключить/);assert.match(manager,/Изменить/);
});
