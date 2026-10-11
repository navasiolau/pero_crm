// Только связывание имеющихся metadata; SQL collector принадлежит принятому stage protocol.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; СТОП при mismatch.
import {nativeAcceptanceBinding} from './native-acceptance-target.ts';
import {canonical117,digest117,need117} from '../kanban-search-owned-protocol.mjs';
const SHA=/^[a-f0-9]{64}$/;
export function guardStageContext(context,approval,environment=process.env){
 need117(context?.target==='staging'&&approval?.authorized===true&&context.runId===approval.runId&&context.revision===approval.revision&&context.scenarioId===approval.scenarioId,'K117_STAGE_APPROVAL_CONTEXT_MISMATCH');
 need117(SHA.test(context.sourceManifestDigest??'')&&context.sourceManifestDigest===approval.sourceManifestDigest&&SHA.test(context.catalogPolicySha256??'')&&context.catalogPolicySha256===approval.catalogPolicySha256,'K117_STAGE_APPROVAL_PROVENANCE_MISMATCH');
 const bound=nativeAcceptanceBinding(context,environment);
 need117(canonical117(bound.identity)===canonical117(approval.identity)&&canonical117(context.identity)===canonical117(approval.identity),'K117_EXACT_STAGE_IDENTITY_MISMATCH');
 return bound;
}
export function qualifyStageSnapshot(snapshot,policy){
 need117(policy?.version===1&&policy.target==='staging'&&policy.databaseName==='crm'&&policy.schema==='public'&&SHA.test(policy.schemaHash??'')&&Array.isArray(policy.ledger)&&policy.ledger.length>0,'K117_EXACT_STAGE_POLICY_REQUIRED');
 need117(snapshot?.databaseName==='crm'&&snapshot.schema==='public'&&snapshot.primary===true&&snapshot.readOnly===true,'K117_ACTUAL_READONLY_DATABASE_REQUIRED');
 need117(snapshot.schemaHash===policy.schemaHash&&canonical117(snapshot.ledger)===canonical117(policy.ledger),'K117_STAGE_LEDGER_CATALOG_MISMATCH');
 for(const row of snapshot.ledger)need117(typeof row.name==='string'&&/^[0-9]{14}_[a-z0-9_]+$/.test(row.name)&&SHA.test(row.checksum??'')&&typeof row.finished==='boolean'&&typeof row.rolledBack==='boolean','K117_STAGE_LEDGER_SHAPE_REQUIRED');
 need117(new Set(snapshot.ledger.map(r=>r.id)).size===snapshot.ledger.length&&snapshot.ledger.every(r=>typeof r.id==='string'&&r.id.length>0),'K117_STAGE_LEDGER_ID_SET_REQUIRED');
 return{status:'QUALIFIED_STAGE_METADATA',policySha256:digest117(policy),schemaHash:snapshot.schemaHash,ledgerSha256:digest117(snapshot.ledger)};
}
