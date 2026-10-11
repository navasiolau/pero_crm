import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const LOCAL_CONTAINER = 'bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5';
export const ORIGINAL_SQL_SHA = 'd0948074ff79ac17f365490440c851650550910a6909d952ca278464b3f80a62';
export const EXPANDED_SQL_SHA = '277540457e9b832e483e0f3de3d09ee47d313bf845388605c6fd03be0488ee96';
export const KINDS = Object.freeze(['ENGINEERING', 'ASSEMBLY', 'INSTALLATION']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
}

export function nativeOutcome() {
  const failures=[];
  return {
    fail(value,phase) {failures.push({value,phase});},
    get hasFailure() {return failures.length>0;},
    get primaryFailure() {return failures[0]?.value;},
    get primaryPhase() {return failures[0]?.phase??null;},
    get failureCount() {return failures.length;},
    get secondaryFailureOccurred() {return failures.length>1;},
    accepted({rollbackConfirmed,disconnected,postGuardsPassed}) {
      return failures.length===0 && rollbackConfirmed===true && disconnected===true && postGuardsPassed===true;
    },
  };
}

async function settledWithin(promise,ms) {
  let timer;
  const expired=new Promise((resolve)=>{timer=setTimeout(()=>resolve({completed:false}),ms);});
  const observed=Promise.resolve(promise).then((value)=>({completed:true,rejected:false,value}),
    (value)=>({completed:true,rejected:true,value}));
  const result=await Promise.race([observed,expired]);clearTimeout(timer);return result;
}

export async function finishOwnedHandle({endInput,exited,terminateOwned},budgetMs=10_000) {
  assert.ok(Number.isFinite(budgetMs)&&budgetMs>0&&budgetMs<=10_000,'QA167_FINISH_BUDGET');
  let inputFailed=false,inputFailure,terminationFailed=false,terminationFailure;
  try {endInput();} catch(value) {inputFailed=true;inputFailure=value;}
  const grace=Math.min(1000,budgetMs/10);
  const first=await settledWithin(exited,budgetMs-grace);
  if(first.completed)return {timedOut:false,exitObserved:!first.rejected,normalExit:!first.rejected&&first.value?.code===0,
    rejected:first.rejected,exitFailure:first.rejected?first.value:undefined,inputFailed,inputFailure,terminationAttempted:false};
  let terminationSignalSent=false;
  try {terminationSignalSent=terminateOwned()===true;} catch(value) {terminationFailed=true;terminationFailure=value;}
  const last=await settledWithin(exited,grace);
  // Timeout остаётся UNKNOWN даже при позднем exit; это не доказательство обычного закрытия psql/БД.
  return {timedOut:true,exitObserved:last.completed&&!last.rejected,normalExit:false,rejected:last.completed&&last.rejected,
    exitFailure:last.rejected?last.value:undefined,inputFailed,inputFailure,terminationAttempted:true,
    terminationSignalSent,terminationFailed,terminationFailure};
}

export function sqlLiteral(value) {
  assert.equal(typeof value, 'string', 'QA167_SQL_LITERAL_TYPE');
  assert.ok(!value.includes('\0'), 'QA167_SQL_LITERAL_NUL');
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlIdentifier(value) {
  assert.match(value, /^[A-Za-z_][A-Za-z0-9_]*$/, 'QA167_SQL_IDENTIFIER');
  return `"${value}"`;
}

export function sqlArray(values) {
  return values.length ? `ARRAY[${values.map(sqlLiteral).join(',')}]::text[]` : 'ARRAY[]::text[]';
}

export function assertContainer(value) {
  assert.deepEqual(Object.keys(value).sort(), ['id', 'name', 'ports', 'running']);
  assert.equal(value.id, LOCAL_CONTAINER, 'QA167_CONTAINER_ID');
  assert.equal(value.name, '/pero_crm_pg', 'QA167_CONTAINER_NAME');
  assert.equal(value.running, true, 'QA167_CONTAINER_RUNNING');
  assert.deepEqual(value.ports, { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5433' }] }, 'QA167_CONTAINER_PORT');
}

export function assertApproval(value, manifestHash, runId, now = new Date()) {
  assert.deepEqual(Object.keys(value).sort(), ['approved', 'containerId', 'exclusiveWindow', 'expiresAt', 'manifestHash', 'observedAt', 'operation', 'runId']);
  assert.equal(value.operation, 'rollback-native167', 'QA167_APPROVAL_OPERATION');
  assert.equal(value.runId, runId, 'QA167_APPROVAL_RUN');
  assert.equal(value.manifestHash, manifestHash, 'QA167_APPROVAL_SOURCE');
  assert.equal(value.containerId, LOCAL_CONTAINER, 'QA167_APPROVAL_TARGET');
  assert.equal(value.approved, true, 'QA167_APPROVAL_GRANT');
  assert.equal(value.exclusiveWindow, true, 'QA167_APPROVAL_WINDOW');
  const observed = Date.parse(value.observedAt), expires = Date.parse(value.expiresAt);
  assert.ok(Number.isFinite(observed) && Number.isFinite(expires) && observed <= now.getTime()
    && now.getTime() < expires && expires - observed <= 15 * 60_000, 'QA167_APPROVAL_TIME');
}

export function fixturePlan(runId) {
  assert.match(runId, uuidPattern, 'QA167_RUN_UUID');
  const label = (suffix) => `qa167-${runId}-${suffix}`;
  const base = 1_700_000_000 + Number.parseInt(digest(runId).slice(0, 5), 16) * 2;
  const cohorts = ['A', 'B'].map((cohort, index) => ({
    id: label(`project-${cohort}`), number: String(base + index), numberInt: base + index,
    setting: label(`setting-${cohort}`),
    products: Array.from({ length: 8 }, (_, mask) => ({
      id: label(`product-${cohort}-${mask}`), number: `${base + index}.${mask + 1}`, mask,
      deleted: [0, 1, 5].includes(mask),
      configs: KINDS.flatMap((kind, bit) => (mask & (1 << bit)) ? [{
        id: label(`config-${cohort}-${mask}-${bit}`), participantId: label(`participant-${cohort}-${mask}-${bit}`),
        kind, rate: bit === 0 ? null : bit === 1 ? '12.50' : '0.00', revision: mask + 2,
        reviewedLegacyWorkIds: [label(`legacy-${cohort}-${mask}-${bit}`)], workReview: { nativeProof: true, mask, bit },
      }] : []),
    })),
  }));
  return { runId, clientId: label('client'), userId: label('user'), email: `qa167.${runId}@invalid.local`, cohorts };
}

export function fixtureOwnedKeys(plan) {
  const products = plan.cohorts.flatMap((cohort) => cohort.products);
  return {
    Client: { key: 'id', values: [plan.clientId] }, User: { key: 'id', values: [plan.userId] },
    Project: { key: 'id', values: plan.cohorts.map((cohort) => cohort.id) },
    Product: { key: 'id', values: products.map((product) => product.id) },
    ProductPercentageConfig: { key: 'id', values: products.flatMap((product) => product.configs.map((config) => config.id)) },
    ProductPercentageParticipant: { key: 'id', values: products.flatMap((product) => product.configs.map((config) => config.participantId)) },
    OrgSetting: { key: 'key', values: plan.cohorts.map((cohort) => cohort.setting) },
  };
}

export function missingFixturePairs(plan) {
  return plan.cohorts.flatMap((cohort) => cohort.products.flatMap((product) => KINDS
    .filter((kind) => !product.configs.some((config) => config.kind === kind))
    .map((kind) => ({ productId: product.id, kind }))));
}

export function pairKey(pair) {
  assert.equal(typeof pair.productId, 'string');
  assert.ok(KINDS.includes(pair.kind), 'QA167_PAIR_KIND');
  return `${pair.productId}\0${pair.kind}`;
}

export function assertPairSet(actual, expected) {
  const keys = actual.map(pairKey).sort(), wanted = expected.map(pairKey).sort();
  assert.equal(new Set(keys).size, keys.length, 'QA167_PAIR_DUPLICATE');
  assert.deepEqual(keys, wanted, 'QA167_PAIR_SCOPE');
}

export function assertGeneratedRows(rows, previousIds, expectedPairs) {
  const before = new Set(previousIds);
  const created = rows.filter((row) => !before.has(row.id));
  assertPairSet(created, expectedPairs);
  assert.equal(new Set(created.map((row) => row.id)).size, created.length, 'QA167_GENERATED_ID_DUPLICATE');
  for (const row of created) {
    assert.match(row.id, uuidPattern, 'QA167_GENERATED_UUID');
    assert.equal(row.rate, '0.00', 'QA167_CREATED_RATE');
    assert.equal(row.revision, 1, 'QA167_CREATED_REVISION');
    assert.deepEqual(row.reviewedLegacyWorkIds, [], 'QA167_CREATED_LEGACY');
    assert.equal(row.workReview, null, 'QA167_CREATED_WORK_REVIEW');
  }
  return created;
}

export function scopedInsertReference(sql, productIds) {
  assert.ok(productIds.length > 0, 'QA167_REFERENCE_SCOPE');
  const conflict = /\s+ON CONFLICT\s*\("productId","kind"\)\s+DO NOTHING;\s*$/;
  const withoutConflict = sql.replace(conflict, ';').trim();
  const start = withoutConflict.indexOf('INSERT INTO "ProductPercentageConfig"');
  assert.ok(start >= 0 && withoutConflict.endsWith(';'), 'QA167_REFERENCE_INSERT');
  const statement = withoutConflict.slice(start, -1);
  assert.equal((statement.match(/;/g) ?? []).length, 0, 'QA167_REFERENCE_SINGLE_INSERT');
  assert.match(statement, /WHERE NOT EXISTS \(SELECT 1 FROM "ProductPercentageConfig" c WHERE c\."productId" = p\."id" AND c\."kind" = k\."kind"::"ProductPercentageKind"\)$/);
  return `${statement} AND p."id" = ANY(${sqlArray(productIds)});`;
}

export function catalogExpression() {
  return `jsonb_build_object(
    'migrationLedger',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',migration_name,'checksum',checksum,
      'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name COLLATE "C",id COLLATE "C"),'[]'::jsonb) FROM "_prisma_migrations"),
    'domainEventColumns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',column_name::text,'type',udt_name::text,
      'nullable',is_nullable::text,'default',column_default::text,'precision',datetime_precision)
      ORDER BY column_name::text COLLATE "C"),'[]'::jsonb) FROM information_schema.columns WHERE table_schema='public' AND table_name='DomainEvent'),
    'domainEventConstraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',conname::text,'definition',pg_get_constraintdef(oid))
      ORDER BY conname::text COLLATE "C"),'[]'::jsonb) FROM pg_constraint WHERE conrelid='public."DomainEvent"'::regclass),
    'domainEventIndexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',indexname::text,'definition',indexdef::text)
      ORDER BY indexname::text COLLATE "C"),'[]'::jsonb) FROM pg_indexes WHERE schemaname='public' AND tablename='DomainEvent'))`;
}

export function tableFingerprintExpression(table, excluded) {
  const where = excluded ? `WHERE ${sqlIdentifier(excluded.key)} <> ALL(${sqlArray(excluded.values)})` : '';
  return `(SELECT jsonb_build_object('count',count(*)::integer,'sha256',encode(sha256(convert_to(
    coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex'))
    FROM ${sqlIdentifier(table)} t ${where})`;
}

export function missingPairsExpression() {
  return `(SELECT coalesce(jsonb_agg(jsonb_build_object('productId',p."id",'kind',k."kind")
    ORDER BY p."id" COLLATE "C",k."kind" COLLATE "C"),'[]'::jsonb)
    FROM "Product" p CROSS JOIN (VALUES ('ENGINEERING'),('ASSEMBLY'),('INSTALLATION')) k("kind")
    WHERE NOT EXISTS(SELECT 1 FROM "ProductPercentageConfig" c WHERE c."productId"=p."id" AND c."kind"=k."kind"::"ProductPercentageKind"))`;
}

export function configRowsExpression() {
  return `(SELECT coalesce(jsonb_agg(jsonb_build_object('id',"id",'productId',"productId",'kind',"kind",'rate',"ratePercent"::text,
    'revision',revision,'reviewedLegacyWorkIds',"reviewedLegacyWorkIds",'workReview',"workReview") ORDER BY "id" COLLATE "C"),'[]'::jsonb)
    FROM "ProductPercentageConfig")`;
}
