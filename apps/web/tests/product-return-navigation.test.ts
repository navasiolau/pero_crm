import assert from 'node:assert/strict';
import test from 'node:test';
import {productDetailHref,projectProductsHref,globalProductsHref,resolveProductReturn,resolveProjectTab} from '../src/lib/product-return-navigation';
test('project entry opens actual parent products tab; direct entry uses same fallback',()=>{
 const parent=projectProductsHref('parent');assert.equal(parent,'/projects/parent?tab=products');const href=productDetailHref('205.1',parent);assert.equal(new URL(href,'https://crm.invalid').searchParams.get('returnTo'),parent);assert.deepEqual(resolveProductReturn(parent,'parent'),{href:parent,label:'Назад к изделиям проекта'});assert.equal(resolveProductReturn(undefined,'parent').href,parent);
});
test('global return preserves canonical view filters sort page without preferences',()=>{
 const href=globalProductsHref('view=table&q=long+name&project=p&client=c&engineer=e&active=0&sort=price&dir=asc&page=3&pageSize=50&unknown=discard');assert.equal(href,'/products?view=table&q=long+name&project=p&client=c&engineer=e&active=0&sort=price&dir=asc&page=3&pageSize=50');assert.deepEqual(resolveProductReturn(href,'parent'),{href,label:'Назад к списку изделий'});assert.equal(resolveProductReturn('/products','parent').href,'/products?view=kanban');
});
test('foreign project and unsafe or ambiguous URLs never become navigation destinations',()=>{
 const fallback=projectProductsHref('parent');for(const value of ['https://evil.invalid/products','//evil.invalid/products','/\\evil.invalid','/products#fragment','/products/../settings','/projects/other?tab=products','/projects/parent?tab=files','/projects/parent?tab=products&next=/settings','/products\n?view=table', [' /products'], ['/products','/projects/parent?tab=products'], '/products?'+ 'a'.repeat(4097)])assert.equal(resolveProductReturn(value,'parent').href,fallback);
});
test('project tab allowlist keeps normal overview and only available tabs',()=>{
 const allowed=['overview','products','files','plugin-active'];assert.equal(resolveProjectTab(undefined,allowed),'overview');assert.equal(resolveProjectTab('products',allowed),'products');assert.equal(resolveProjectTab('plugin-active',allowed),'plugin-active');for(const value of ['finance','../products',['products','files']])assert.equal(resolveProjectTab(value,allowed),'overview');
});
