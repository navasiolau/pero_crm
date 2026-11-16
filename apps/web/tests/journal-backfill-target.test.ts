import assert from 'node:assert/strict';
import {test} from 'node:test';
import {journalBackfillTarget,assertJournalBackfillIdentity} from '../src/server/changelog/backfill-target';

const local={DATABASE_URL:'postgresql://pero:unused@127.0.0.1:5433/pero_crm',PERO_JOURNAL_BACKFILL_TARGET:'local',PERO_JOURNAL_BACKFILL_HOST:'local',PERO_JOURNAL_BACKFILL_SYSTEM_ID:'7663912963695341602',PERO_JOURNAL_BACKFILL_REVISION:'a'.repeat(40)};
test('backfill validates exact reviewed local target and live database identity',()=>{
 const target=journalBackfillTarget(local);
 assert.doesNotThrow(()=>assertJournalBackfillIdentity(target,{database:'pero_crm',schema:'public',role:'pero',systemIdentifier:target.systemIdentifier}));
 for(const change of [{DATABASE_URL:'postgresql://pero:unused@localhost:5432/pero_crm'},{DATABASE_URL:'postgresql://pero:unused@example.invalid:5433/pero_crm'},{PERO_JOURNAL_BACKFILL_TARGET:'production'},{PERO_JOURNAL_BACKFILL_SYSTEM_ID:'wrong'},{PERO_JOURNAL_BACKFILL_REVISION:''}])assert.throws(()=>journalBackfillTarget({...local,...change}),/STOP/);
 assert.throws(()=>assertJournalBackfillIdentity(target,{database:'pero_crm',schema:'public',role:'pero',systemIdentifier:'other-cluster'}),/STOP/);
 assert.throws(()=>assertJournalBackfillIdentity({...target,systemIdentifier:'forged'},{database:'pero_crm',schema:'public',role:'pero',systemIdentifier:'forged'}),/STOP/);
});
test('staging requires all independent identity stamps and rejects production bucket',()=>{
 const stage={...local,DATABASE_URL:'postgresql://crm:unused@db:5432/crm',PERO_JOURNAL_BACKFILL_TARGET:'staging',PERO_JOURNAL_BACKFILL_HOST:'crm-staging',PERO_JOURNAL_BACKFILL_SYSTEM_ID:'7680344238676262945',S3_BUCKET:'pero-crm-staging'};
 assert.equal(journalBackfillTarget(stage).kind,'staging');
 for(const change of [{S3_BUCKET:'pero-crm'},{PERO_JOURNAL_BACKFILL_HOST:'crm'},{PERO_JOURNAL_BACKFILL_SYSTEM_ID:local.PERO_JOURNAL_BACKFILL_SYSTEM_ID}])assert.throws(()=>journalBackfillTarget({...stage,...change}),/STOP/);
 assert.equal(journalBackfillTarget({...stage,DATABASE_URL:'postgresql://crm:unused@127.0.0.1:25432/crm'}).kind,'staging');
});
