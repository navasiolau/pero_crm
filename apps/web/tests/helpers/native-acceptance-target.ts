import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {hostname} from 'node:os';
import {existingLocalCrmDatabaseUrl} from './local-crm-database';

export type NativeDeclaration={target:'local'|'staging';revision:string;runId:string;scenarioId:string};
export type NativeBinding={url:string;identity:Record<string,unknown>};
const allowed=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
export function nativeAcceptanceBinding(input:NativeDeclaration,environment:NodeJS.ProcessEnv=process.env):NativeBinding {
  assert.match(input.revision,/^[a-f0-9]{40}$/,'NATIVE_REVISION_REQUIRED');
  assert.match(input.runId,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,'NATIVE_RUN_ID_REQUIRED');
  assert.ok(input.target==='local'||input.target==='staging','TEST_TARGET_ONLY');
  assert.match(input.scenarioId,/^[a-z0-9][a-z0-9.-]{0,100}$/,'NATIVE_SCENARIO_REQUIRED');
  if(input.target==='local') {
    assert.equal(process.platform,'win32','LOCAL_PLATFORM_REQUIRED');
    assert.equal(environment.CRM_LOCAL_CONTAINER_ID,process.env.CRM_LOCAL_CONTAINER_ID,'LOCAL_ENVIRONMENT_IDENTITY_MISMATCH');
    const url=existingLocalCrmDatabaseUrl();
    return {url,identity:{target:'local',revision:input.revision,containerId:environment.CRM_LOCAL_CONTAINER_ID,databaseName:'pero_crm',schema:'public',port:5433}};
  }
  assert.equal(environment.CRM_MODERNIZATION_TARGET,'staging','STAGING_WRAPPER_REQUIRED');
  assert.equal(process.platform,'linux','STAGING_CONTAINER_REQUIRED');
  assert.ok(existsSync('/.dockerenv'),'STAGING_CONTAINER_REQUIRED');
  const proof=JSON.parse(environment.CRM_MODERNIZATION_STAGE_PROOF??'null') as Record<string,unknown>|null;
  assert.ok(proof?.hostname==='crm-staging'&&proof.revision===input.revision&&typeof proof.web==='string'&&proof.web.startsWith(hostname())&&typeof proof.database==='string'&&proof.database.length===64&&proof.databaseVolume==='crm-staging_pgdata'&&typeof proof.image==='string'&&proof.image.startsWith('sha256:')&&typeof proof.outerW07Sha256==='string'&&proof.outerW07Sha256.length===64,'STAGE_IDENTITY_REQUIRED');
  const url=new URL(environment.DATABASE_URL??'');
  assert.ok((url.protocol==='postgres:'||url.protocol==='postgresql:')&&url.hostname==='db'&&url.pathname==='/crm'&&(!url.port||url.port==='5432')&&!url.hash,'STAGING_DATABASE_BINDING_REQUIRED');
  assert.ok([...url.searchParams.keys()].every(key=>allowed.has(key)&&url.searchParams.getAll(key).length===1),'DATABASE_OPTION_REFUSED');
  assert.ok(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public','PUBLIC_SCHEMA_REQUIRED');
  return {url:url.toString(),identity:proof};
}
export async function nativeDatabaseIdentity(db:{ $queryRawUnsafe<T=unknown>(query:string):Promise<T> },input:NativeDeclaration) {
  const rows=await db.$queryRawUnsafe<{name:string;schema:string}[]>('SELECT current_database() AS name,current_schema() AS schema');
  assert.deepEqual(rows,[{name:input.target==='local'?'pero_crm':'crm',schema:'public'}],'DATABASE_IDENTITY_MISMATCH');
}
