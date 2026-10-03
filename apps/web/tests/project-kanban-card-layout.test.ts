import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
const pushes:string[]=[];let coverClick:((event:{stopPropagation:()=>void})=>void)|undefined,dragging=false;
const captureReact={...React,createElement:(type:unknown,props:Record<string,unknown>|null,...children:React.ReactNode[])=>{if(type==='button'&&typeof props?.['aria-label']==='string'&&props['aria-label'].startsWith('Открыть проект'))coverClick=props.onClick as typeof coverClick;return React.createElement(type as React.ElementType,props,...children);}};
inject('react',captureReact);Object.assign(globalThis,{React:captureReact});
inject('next/navigation',{useRouter:()=>({push:(href:string)=>pushes.push(href),refresh(){throw Error('REFRESH_FORBIDDEN')}})});
inject('../src/server/projects/stage-actions',{patchProjectStage(){throw Error('WRITE_FORBIDDEN')}});
inject('../src/app/(app)/projects/stage-form-dialog',{StageFormDialog:()=>null});
inject('@dnd-kit/core',{DndContext:({children}:{children:React.ReactNode})=>children,DragOverlay:()=>null,PointerSensor:()=>null,useDraggable:()=>({attributes:{},listeners:{},setActivatorNodeRef(){},setNodeRef(){},transform:null,isDragging:dragging}),useDroppable:()=>({setNodeRef(){},isOver:false}),useSensors:()=>[],useSensor:()=>({})});
const{KanbanBoard}=require('../src/app/(app)/projects/kanban-board') as typeof import('../src/app/(app)/projects/kanban-board');
const project:import('../src/app/(app)/projects/projects-view').ProjectCard={id:'project',number:'205',title:'Project title',stage:'LEAD' as const,stageChangedAt:new Date(Date.now()-2*86400000).toISOString(),totalPrice:'1500',currency:'BYN',clientId:'client',clientName:'Client name',managerName:null,productsCount:2,tasksCount:3,filesCount:4,hasMaterialShortage:true,coverFile:{id:'cover',fileName:'cover.png',mimeType:'image/png',hasThumb:false}};
function card(showAmount=true,overrides:Partial<typeof project>={}){coverClick=undefined;return renderToStaticMarkup(React.createElement(KanbanBoard,{initialProjects:[{...project,...overrides}],canManage:false,showAmount}));}
test('actual Project board cover precedes number title client and number-only amount, counters remain',()=>{const html=card();assert.match(html,/preview=card/);assert.ok(html.indexOf('preview=card')<html.indexOf('data-card-number'));assert.ok(html.indexOf('data-card-number')<html.indexOf('Project title</'));assert.ok(html.indexOf('Project title</')<html.indexOf('Client name</'));assert.ok(html.indexOf('Client name</')<html.indexOf('1 500'));assert.doesNotMatch(html,/BYN|Сумма:/);assert.match(html,/2 дн\./);assert.match(html,/Нехватка материалов/);});
test('cover actual DOM click opens project once while dragging blocks it',()=>{pushes.length=0;dragging=false;card();assert.ok(coverClick);let stopped=0;coverClick!({stopPropagation(){stopped++}});assert.deepEqual(pushes,['/projects/project']);assert.equal(stopped,1);pushes.length=0;dragging=true;card();coverClick!({stopPropagation(){}});assert.deepEqual(pushes,[]);dragging=false;});
test('readonly amount hidden, unknown remains dash, explicit zero remains numeric',()=>{assert.doesNotMatch(card(false),/1 500/);assert.match(card(true,{totalPrice:'0'}),/data-project-amount[^>]*>0</);assert.match(card(true,{totalPrice:null}),/data-project-amount[^>]*>—</);assert.doesNotMatch(card(true,{currency:'USD'}),/1 500/);});
test('current stage transition wins even after return to LEAD; createdAt only initial with no history',async()=>{
 const {projectStageAgeStart,projectStageDays}=await import('../src/lib/project-kanban-values');const createdAt='2026-01-01T00:00:00Z',stageChangedAt='2026-10-02T00:00:00Z';
 const base={stage:'LEAD' as const,createdAt,stageChangedAt};assert.equal(projectStageAgeStart(base),createdAt);assert.equal(projectStageAgeStart({...base,latestTransition:{toStage:'LEAD',createdAt:stageChangedAt}}),stageChangedAt);assert.equal(projectStageAgeStart({...base,stage:'IN_WORK' as const}),stageChangedAt);assert.equal(projectStageDays(stageChangedAt,new Date('2026-10-04T00:00:00Z').getTime()),2);assert.equal(projectStageDays('invalid',Date.now()),null);
});

 test('legacy different-stage history never resets age to project creation; future date is unavailable',async()=>{
 const {projectStageAgeStart,projectStageDays}=await import('../src/lib/project-kanban-values');const changed='2026-10-02T12:00:00Z';assert.equal(projectStageAgeStart({stage:'IN_WORK',createdAt:'2025-01-01T00:00:00Z',stageChangedAt:changed,latestTransition:{toStage:'ESTIMATE',createdAt:'2026-02-01T00:00:00Z'}}),changed);assert.equal(projectStageDays('2026-10-04T00:00:00Z',new Date('2026-10-03T00:00:00Z').getTime()),null);
 });
