export type JournalBackfillTarget={kind:'local'|'staging';database:string;role:string;systemIdentifier:string;revision:string};
export type JournalDatabaseIdentity={database:string;schema:string;role:string;systemIdentifier:string};
const IDENTITIES={
 local:{database:'pero_crm',role:'pero',systemIdentifier:'7663912963695341602'},
 staging:{database:'crm',role:'crm',systemIdentifier:'7680344238676262945'},
} as const;

/** Идентичности перечитаны root 16.11.2026; новая цель требует отдельного reviewed изменения. */
export function journalBackfillTarget(environment:Record<string,string|undefined>):JournalBackfillTarget{
 const kind=environment.PERO_JOURNAL_BACKFILL_TARGET;
 if(kind!=='local'&&kind!=='staging')throw Error('JOURNAL_BACKFILL_TARGET_STOP');
 const expected=IDENTITIES[kind];let url:URL;
 try{url=new URL(environment.DATABASE_URL??'');}catch{throw Error('JOURNAL_BACKFILL_TARGET_STOP');}
 const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!['postgres:','postgresql:'].includes(url.protocol)||decodeURIComponent(url.pathname.slice(1))!==expected.database||decodeURIComponent(url.username)!==expected.role||
  environment.PERO_JOURNAL_BACKFILL_SYSTEM_ID!==expected.systemIdentifier||!/^[a-f0-9]{40}$/.test(environment.PERO_JOURNAL_BACKFILL_REVISION??''))throw Error('JOURNAL_BACKFILL_TARGET_STOP');
 if(kind==='local'&&(!loopback||url.port!=='5433'||environment.PERO_JOURNAL_BACKFILL_HOST!=='local'))throw Error('JOURNAL_BACKFILL_TARGET_STOP');
 if(kind==='staging'&&(!(loopback||(url.hostname==='db'&&(!url.port||url.port==='5432')))||url.port==='5433'||environment.PERO_JOURNAL_BACKFILL_HOST!=='crm-staging'||environment.S3_BUCKET!=='pero-crm-staging'))throw Error('JOURNAL_BACKFILL_TARGET_STOP');
 return {kind,...expected,revision:environment.PERO_JOURNAL_BACKFILL_REVISION!};
}

export function assertJournalBackfillIdentity(target:JournalBackfillTarget,identity:JournalDatabaseIdentity):void{
 const fixed=IDENTITIES[target.kind];
 if(!fixed||target.database!==fixed.database||target.role!==fixed.role||target.systemIdentifier!==fixed.systemIdentifier||
  identity.database!==fixed.database||identity.schema!=='public'||identity.role!==fixed.role||identity.systemIdentifier!==fixed.systemIdentifier)throw Error('JOURNAL_BACKFILL_DATABASE_STOP');
}
