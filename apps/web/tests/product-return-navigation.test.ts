import assert from 'node:assert/strict';
import test from 'node:test';
import {productDetailHref,projectProductsHref,globalProductsHref,resolveProductReturn,resolveProjectTab} from '../src/lib/product-return-navigation';
import {MAX_LIST_QUERY_LENGTH} from '../src/lib/list-state';
test('project entry opens actual parent products tab; direct entry uses same fallback',()=>{
 const parent=projectProductsHref('parent');assert.equal(parent,'/projects/parent?tab=products');const href=productDetailHref('205.1',parent);assert.equal(new URL(href,'https://crm.invalid').searchParams.get('returnTo'),parent);assert.deepEqual(resolveProductReturn(parent,'parent'),{href:parent,label:'Назад к изделиям проекта'});assert.equal(resolveProductReturn(undefined,'parent').href,parent);
});
test('global return preserves canonical view filters sort page without preferences',()=>{
 const href=globalProductsHref('view=table&q=long+name&project=p&client=c&engineer=e&active=0&sort=price&dir=asc&page=3&pageSize=50&unknown=discard');assert.equal(href,'/products?view=table&q=long+name&project=%5B%22p%22%5D&client=%5B%22c%22%5D&engineer=%5B%22e%22%5D&active=0&sort=price&dir=asc&page=3&pageSize=50');assert.deepEqual(resolveProductReturn(href,'parent'),{href,label:'Назад к списку изделий'});assert.equal(resolveProductReturn('/products','parent').href,'/products?view=kanban');
});
test('multi-value filters roundtrip through product details and back without losing list state',()=>{
 const query=new URLSearchParams({view:'table',q:'Кухня + шкаф',status:'["PRODUCTION","DESIGN"]',project:'["p2","p1"]',client:'["c2","c1"]',engineer:'["e2","e1"]',active:'1',sort:'price',dir:'asc',page:'3',pageSize:'50'});
 const list=globalProductsHref(query.toString());
 const details=productDetailHref('205.1',list);
 const returnTo=new URL(details,'https://crm.invalid').searchParams.get('returnTo');
 assert.equal(returnTo,list);
 const back=resolveProductReturn(returnTo,'parent');
 assert.equal(back.label,'Назад к списку изделий');
 assert.equal(back.href,list);
 assert.deepEqual(Object.fromEntries(new URL(back.href,'https://crm.invalid').searchParams),{view:'table',q:'Кухня + шкаф',project:'["p1","p2"]',client:'["c1","c2"]',engineer:'["e1","e2"]',status:'["DESIGN","PRODUCTION"]',active:'1',sort:'price',dir:'asc',page:'3',pageSize:'50'});
});
test('a saved multi-selection longer than 4096 characters survives the detail return roundtrip',()=>{
 const clients=Array.from({length:150},(_,index)=>`client-${index}-${'x'.repeat(20)}`);
 const list=globalProductsHref(new URLSearchParams({view:'table',client:JSON.stringify(clients),project:'["p1","p2"]',engineer:'["e1","e2"]',status:'["DESIGN","PRODUCTION"]',page:'3',pageSize:'50'}).toString());
 assert.ok(list.length>4096);
 assert.ok(list.length<MAX_LIST_QUERY_LENGTH);
 const details=productDetailHref('205.1',list);
 const returnTo=new URL(details,'https://crm.invalid').searchParams.get('returnTo');
 assert.equal(returnTo,list);
 const back=resolveProductReturn(returnTo,'parent');
 assert.equal(back.href,list);
 assert.deepEqual(new Set(JSON.parse(new URL(back.href,'https://crm.invalid').searchParams.get('client')!)),new Set(clients));
 assert.equal(new URL(back.href,'https://crm.invalid').searchParams.get('engineer'),'["e1","e2"]');
 assert.equal(new URL(back.href,'https://crm.invalid').searchParams.get('status'),'["DESIGN","PRODUCTION"]');
 assert.equal(new URL(back.href,'https://crm.invalid').searchParams.get('page'),'3');
});
test('foreign project and unsafe or ambiguous URLs never become navigation destinations',()=>{
 const fallback=projectProductsHref('parent');for(const value of ['https://evil.invalid/products','//evil.invalid/products','/\\evil.invalid','/products#fragment','/products/../settings','/projects/other?tab=products','/projects/parent?tab=files','/projects/parent?tab=products&next=/settings','/products\n?view=table', [' /products'], ['/products','/projects/parent?tab=products'], '/products?'+ 'a'.repeat(MAX_LIST_QUERY_LENGTH+1)])assert.equal(resolveProductReturn(value,'parent').href,fallback);
});
test('project tab allowlist keeps normal overview and only available tabs',()=>{
 const allowed=['overview','products','files','plugin-active'];assert.equal(resolveProjectTab(undefined,allowed),'overview');assert.equal(resolveProjectTab('products',allowed),'products');assert.equal(resolveProjectTab('plugin-active',allowed),'plugin-active');for(const value of ['finance','../products',['products','files']])assert.equal(resolveProjectTab(value,allowed),'overview');
});
