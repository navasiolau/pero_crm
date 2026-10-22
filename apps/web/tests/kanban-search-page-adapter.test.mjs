import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve("tsx/package.json"))("esbuild");
const boundaries={
 "next/navigation":"export function redirect(href){throw new Error('redirect:'+href)}",
 "@/auth":"export async function auth(){return {user:{id:'actor117',roles:['ADMIN']}}}",
 "@/server/list-preferences":`import {normalizeListQuery} from '@/lib/list-state';export const listPreferences={load:async(section,params)=>({query:normalizeListQuery(section,new URLSearchParams(params).toString()),value:null})};`,
 "@/server/projects/queries":`import {parseListFilterValue} from '@/lib/list-filter-values';
 export function parseProjectListParams(params){return {filters:{q:params.q||undefined,activeOnly:params.active==='1',clientIds:parseListFilterValue(params.client)},page:2,pageSize:20}};
 export async function listProjects(id,roles,filters,paging){globalThis.__page117={id,roles,filters,paging};return {total:1,rows:[{id:'p',number:'199',title:'Название',stage:'IN_WORK',createdAt:new Date(0),stageChangedAt:new Date(0),stageHistory:[],currency:'BYN',client:{id:'client',name:'Клиент'},manager:null,products:[],_count:{products:0,tasks:0,files:0},hasMaterialShortage:false}]}};
 export async function listClientOptions(){return []}export async function listManagers(){return []}export async function listEngineers(){return []}`,
 "@/server/products/queries":`import {parseListFilterValue} from '@/lib/list-filter-values';
 export function parseProductListParams(params){return {filters:{q:params.q||undefined,activeOnly:params.active==='1',clientIds:parseListFilterValue(params.client)},page:2,pageSize:20}};
 export async function listProducts(id,roles,filters,paging){globalThis.__page117={id,roles,filters,paging};return {total:1,rows:[{id:'i',number:'199.5',title:'Изделие',status:'DESIGN',statusChangedAt:new Date(0),quantity:1,expectedPrice:null,project:{id:'p',stage:'IN_WORK',number:'199',title:'Заказ',currency:'BYN',client:{id:'client',name:'Клиент'}}}]}};
 export async function listProductFilterOptions(){return {projects:[],clients:[]}}`,
 "@/lib/list-params":"export function ListParamsProvider(){return null}",
};
const pages=Promise.all(['projects','products'].map(async(section)=>{
 const bundle=await build({entryPoints:[path.join(web,`src/app/(app)/${section}/page.tsx`)],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),external:['react','react/jsx-runtime','@prisma/client'],plugins:[{
  name:'server-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>{
   if(boundaries[args.path])return {path:args.path,namespace:'boundary'};
   if(args.path===`./${section}-view`)return {path:section,namespace:'view'};
  });builder.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:web}));
  builder.onLoad({filter:/.*/,namespace:'view'},args=>({contents:`export function ${args.path==='projects'?'ProjectsView':'ProductsView'}(){return null}`,loader:'tsx'}));}
 }]});
 const loaded=new Module(path.join(web,`tests/page-${section}-117.cjs`));loaded.filename=path.join(web,`tests/page-${section}-117.cjs`);loaded.paths=Module._nodeModulePaths(web);loaded._compile(bundle.outputFiles[0].text,loaded.filename);return loaded.exports.default;
}));
for(const [index,section] of ['projects','products'].entries()){
 test(`${section} server page chooses number search for kanban and pairs resolved query with rows`,async()=>{
  const page=(await pages)[index],q=section==='projects'?'199':'199.5';const tree=await page({searchParams:Promise.resolve({view:'kanban',q,client:'client',active:'1',searchScope:'all'})});
  const capture=globalThis.__page117;assert.equal(capture.id,'actor117');assert.deepEqual(capture.roles,['ADMIN']);
  assert.equal(capture.filters.searchScope,'number');assert.equal(capture.filters.q,q);assert.deepEqual(capture.filters.clientIds,['client']);assert.equal(capture.filters.activeOnly,true);assert.equal(capture.paging,undefined);
  const view=tree.props.children;assert.equal(view.props.resolvedQuery,tree.props.initialQuery);assert.equal(new URLSearchParams(view.props.resolvedQuery).get('q'),q);assert.equal(new URLSearchParams(view.props.resolvedQuery).has('searchScope'),false);assert.equal(view.props[section].length,1);
 });
 test(`${section} table applies the same number scope while retaining pagination`,async()=>{
  const page=(await pages)[index];const tree=await page({searchParams:Promise.resolve({view:'table',q:'CustomerToken',searchScope:'identity'})});
  assert.equal(globalThis.__page117.filters.searchScope,'number');assert.equal(globalThis.__page117.filters.q,'CustomerToken');assert.deepEqual(globalThis.__page117.paging,{page:2,pageSize:20});assert.equal(tree.props.children.props.view,'table');
 });
}
