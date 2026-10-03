import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
const owner={};inject('../src/components/product-inline-provider',{useProductInline:()=>({controller:()=>owner,registerGuard:()=>()=>{}})});inject('../src/lib/independent-product-finish-action',{invokeProductFinishPatch(){throw Error('SSR_WRITE_FORBIDDEN')}});Object.assign(globalThis,{React});
const{ProductFinishAssignments}=require('../src/components/product-finish-assignments') as typeof import('../src/components/product-finish-assignments');
const row={id:randomUUID(),productId:'p',element:'Корпус',finishId:randomUUID(),finishKind:'ENAMEL' as const,finishName:'Stored name',finishCode:'OLD',finishColor:'Белый',catalogRevision:2};
const choice={id:row.finishId,kind:'ENAMEL' as const,name:'Edited catalogue name',code:'NEW',color:'Black',active:true,revision:9,updatedAt:new Date(0).toISOString()};
test('ordinary readonly component renders snapshot not later catalogue values and no mutation controls',()=>{const html=renderToStaticMarkup(React.createElement(ProductFinishAssignments,{productId:'p',initial:{revision:0,rows:[row]},choices:[choice],canEdit:false}));assert.match(html,/Stored name/);assert.match(html,/OLD/);assert.match(html,/Белый/);assert.doesNotMatch(html,/Edited catalogue name|Добавить элемент|Удалить элемент/);});
test('editable component uses plain element presets and actual required active choice control',()=>{const html=renderToStaticMarkup(React.createElement(ProductFinishAssignments,{productId:'p',initial:{revision:0,rows:[row]},choices:[choice],canEdit:true}));assert.match(html,/Добавить элемент/);assert.match(html,/value="Корпус"/);assert.match(html,/value="Фасады"/);assert.match(html,/value="Столешница"/);assert.match(html,/finish-new-choice/);assert.doesNotMatch(html,/BOM|CAD|3D/);});
