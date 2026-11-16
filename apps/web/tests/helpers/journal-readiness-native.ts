import assert from 'node:assert/strict';
import {Prisma} from '@prisma/client';
import {buildJournalPresentation,parseJournalPresentation} from '../../src/server/changelog/presentation';
import {JOURNAL_PRESENTATION_JSONPATH,type JournalReadDb} from '../../src/server/changelog/sql-store';

/** SELECT-only проверка parity SQL schema guard и действующего TypeScript parser. */
export async function runJournalReadinessParity(db:JournalReadDb):Promise<number>{
 const base=buildJournalPresentation({actorType:'user',actorId:'u',entity:'product',entityId:'p',action:'update',oldValue:{title:'a'},newValue:{title:'b'}});
 const cases:unknown[]=[base,null,{},[],{...base,version:[1]},{...base,version:2},{...base,kind:['event']},
  {...base,actor:{...base.actor,type:['user']}},{...base,contexts:[{id:'p',label:'x'}]},
  {...base,contexts:[{kind:['project'],id:'p',label:'x'}]},{...base,links:[{type:'project',id:'p'}]},
  {...base,changes:[{path:'x',label:'x',before:null,after:null,beforeKnown:null,afterKnown:true}]}];
 for(const key of ['actor','entity','action','source','technical','contexts','changes','links','reason','initiator']){
  for(const value of [null,[],{},'wrong'])cases.push({...base,[key]:value});
 }
 const rows=await db.$queryRaw<{n:number;ready:boolean}[]>(Prisma.sql`SELECT ordinality::int AS n,
  COALESCE(jsonb_path_exists(value,${JOURNAL_PRESENTATION_JSONPATH}::jsonpath,'{}'::jsonb,true),false) AS ready
  FROM jsonb_array_elements(${JSON.stringify(cases)}::jsonb) WITH ORDINALITY`);
 for(const row of rows)assert.equal(row.ready,parseJournalPresentation(cases[row.n-1])!==null,`readiness case ${row.n}`);
 return rows.length;
}
