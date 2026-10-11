import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
type Db=Pick<PrismaClient,'$queryRawUnsafe'>;
export type PercentagePrerequisites={
 constraints:{table:string;name:string;type:string;validated:boolean}[];
 indexes:{name:string;unique:boolean;valid:boolean;ready:boolean}[];
 triggers:{table:string;name:string;function:string;enabled:string;events:number}[];
};
const constraints=[
 ['ProductPercentageCompletion','ProductPercentageCompletion_version_shape','c'],
 ['ProductPercentageCompletion','ProductPercentageCompletion_rate_range','c'],
 ['ProductPercentageAdjustment','ProductPercentageAdjustment_shape','c'],
 ['PayrollEntry','PayrollEntry_percentage_fields','c'],
 ['PayrollEntry','PayrollEntry_percentage_adjustment_fields','c'],
 ['ProductPercentageAdjustment','ProductPercentageAdjustment_completionShareId_fkey','f'],
 ['PayrollEntry','PayrollEntry_percentageAdjustmentId_fkey','f'],
 ['PayrollEntry','PayrollEntry_percentageCompletionShareId_fkey','f'],
];
const indexes=['ProductPercentageAdjustment_clientMutationId_key','ProductPercentageAdjustment_completionShareId_configRevision_key','PayrollEntry_percentageAdjustmentId_key','PayrollEntry_percentageCompletionShareId_key'];
const triggers=[
 ['ProductPercentageCompletion','ProductPercentageCompletion_frozen','protect_product_percentage_completion',27],
 ['ProductPercentageCompletionShare','ProductPercentageCompletionShare_frozen','protect_product_percentage_share',27],
 ['ProductPercentageAdjustment','ProductPercentageAdjustment_source','validate_product_percentage_adjustment',7],
 ['ProductPercentageAdjustment','ProductPercentageAdjustment_append_only','reject_product_payment_history_mutation',27],
 ['PayrollEntry','PayrollEntry_percentage_adjustment_source','validate_product_percentage_adjustment_payroll',7],
 ['PayrollEntry','PayrollEntry_product_settlement_append_only','protect_settled_product_payroll_entry',27],
] as const;
export function validatePercentagePrerequisites(input:PercentagePrerequisites) {
 for(const [table,name,type] of constraints)assert.ok(input.constraints.some(row=>row.table===table&&row.name===name&&row.type===type&&row.validated),'PERCENTAGE_CONSTRAINT_PREREQUISITE');
 for(const name of indexes)assert.ok(input.indexes.some(row=>row.name===name&&row.unique&&row.valid&&row.ready),'PERCENTAGE_UNIQUE_INDEX_PREREQUISITE');
 for(const [table,name,fn,events] of triggers)assert.ok(input.triggers.some(row=>row.table===table&&row.name===name&&row.function===fn&&['O','A'].includes(row.enabled)&&row.events===events),'PERCENTAGE_TRIGGER_PREREQUISITE');
}
export async function assertPercentagePrerequisites(db:Db) {
 const constraints=await db.$queryRawUnsafe<PercentagePrerequisites['constraints']>("SELECT t.relname AS \"table\",c.conname AS name,c.contype::text AS type,c.convalidated AS validated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'");
 const indexes=await db.$queryRawUnsafe<PercentagePrerequisites['indexes']>("SELECT c.relname AS name,i.indisunique AS \"unique\",i.indisvalid AS valid,i.indisready AS ready FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'");
 const triggers=await db.$queryRawUnsafe<PercentagePrerequisites['triggers']>("SELECT t.relname AS \"table\",g.tgname AS name,p.proname AS \"function\",g.tgenabled::text AS enabled,g.tgtype::int AS events FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_proc p ON p.oid=g.tgfoid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND NOT g.tgisinternal");
 validatePercentagePrerequisites({constraints,indexes,triggers});
}
