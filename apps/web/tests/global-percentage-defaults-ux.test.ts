import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {singleProductPercentagePreview} from '../src/lib/single-product-percentage-ui';
import type {Role} from '@prisma/client';
import type {ProductPercentageSectionView} from '../src/lib/product-percentage-view';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let roles:Role[]=['MANAGER'];
inject('../src/auth',{auth:async()=>({user:{id:'viewer',roles}})});
inject('next/navigation',{redirect(){throw Error('SETTINGS_ACCESS_DENIED')},useRouter:()=>({refresh(){throw Error('SSR_REFRESH_FORBIDDEN')}})});
inject('../src/components/product-inline-provider',{useOptionalProductInline:()=>null});
inject('../src/lib/independent-product-percentage-action',{invokeProductPercentagePatch(){throw Error('SSR_WRITE_FORBIDDEN')}});
inject('../src/server/product-percentage-pay/actions',{retryProductPercentageAction(){throw Error('SSR_WRITE_FORBIDDEN')}});
(globalThis as unknown as {React:typeof React}).React=React;
const{default:SettingsPage}=require('../src/app/(app)/settings/page') as typeof import('../src/app/(app)/settings/page');
const{SinglePercentageRow}=require('../src/app/(app)/products/[id]/product-percentage-panel') as typeof import('../src/app/(app)/products/[id]/product-percentage-panel');
const section:ProductPercentageSectionView={kind:'ENGINEERING',state:'DRAFT',hasConfiguration:true,ratePercent:'5',currentRatePercent:'5',price:'1000.00',unitPrice:'1000.00',quantity:3,calculationVersion:3,productCurrency:'BYN',payrollCurrency:'BYN',total:null,members:[],revision:1,canManage:false,canTransfer:false,ownMember:null,legacyPaidSummary:null,skippedSnapshot:null,transferCandidates:[],assignee:{userId:'engineer',name:'Engineer',active:true,eligible:true}};
function panel(overrides:Partial<ProductPercentageSectionView>={}){return renderToStaticMarkup(React.createElement(SinglePercentageRow,{productId:'product',kind:'ENGINEERING',section:{...section,...overrides},canManage:false,canViewAll:true,candidates:[]}));}
test('actual Settings root shows manager union only percentage card and retains admin cards',async()=>{
 for(const value of [['MANAGER'],['MANAGER','ENGINEER']] as Role[][]){roles=value;const html=renderToStaticMarkup(await SettingsPage());assert.match(html,/href="\/settings\/product-percentages"/);for(const path of ['users','payroll','modules','api'])assert.doesNotMatch(html,new RegExp('href="/settings/'+path+'"'));}
 roles=['ADMIN'];const html=renderToStaticMarkup(await SettingsPage());for(const path of ['users','payroll','modules','api','product-percentages'])assert.ok(html.includes('href="/settings/'+path+'"'));
});
test('actual Settings page denies readonly office and field roles without any default writes',async()=>{
 for(const value of [['ENGINEER'],['ACCOUNTANT'],['WORKER'],['MOUNTER']] as Role[][]){roles=value;await assert.rejects(async()=>SettingsPage(),/SETTINGS_ACCESS_DENIED/);}
});
test('actual engineering draft shows only Sum50BYN, with no base or saved-price hints',()=>{const html=panel();assert.match(html,/Сумма:/);assert.match(html,/50 BYN/);assert.doesNotMatch(html,/База:|По сохранённым/);});
test('draft null differs from explicit zero and frozen totals are shown',()=>{
 assert.match(panel({unitPrice:null,price:null}),/Сумма: —/);assert.match(panel({currentRatePercent:'0',ratePercent:'0'}),/0 BYN/);const frozen=panel({state:'SETTLED',total:'150.00',unitPrice:'9999.00',quantity:99});assert.match(frozen,/Сумма:/);assert.match(frozen,/150/);assert.equal(singleProductPercentagePreview({state:'SETTLED',kind:'ENGINEERING',version:2,unitPrice:'9999.00',quantity:99,rate:'5',frozenTotal:'150.00'}),'150.00');
});

test('actual percentage row contains no former-work classification controls',()=>{assert.doesNotMatch(panel(),/Проверка прежних работ|Выберите решение|Включено в процентный этап|Самостоятельная сдельная работа/);});
