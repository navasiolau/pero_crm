import { existsSync } from 'node:fs';
import { hostname } from 'node:os';

type Runtime = { platform: string; hostname: string; docker: boolean };
/** Staging без AUTH_URL подтверждается тем же внешним proof, что native QA, и hostname самого web. */
export function assertClientReconciliationTarget(target: string | undefined, url: URL, apply: boolean,
  env: NodeJS.ProcessEnv = process.env, runtime: Runtime = { platform: process.platform, hostname: hostname(), docker: existsSync('/.dockerenv') }) {
  const fail = (): never => { throw Error('TARGET_GUARD_MISMATCH'); };
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) fail();
  if (target === 'local') {
    if (runtime.platform !== 'win32' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.port !== '5433' || url.pathname !== '/pero_crm' || url.username !== 'pero') fail();
    return;
  }
  const origin = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (url.hostname !== 'db' || url.pathname !== '/crm' || url.username !== 'crm' || !['','5432'].includes(url.port)) fail();
  if (target === 'production') {
    if (origin !== 'https://crm.peromebel.by' || env.S3_BUCKET !== 'pero-crm' || apply && env.CRM_KP_CLIENT_RECONCILIATION_APPROVED !== '1') fail();
    return;
  }
  if (target !== 'staging' || runtime.platform !== 'linux' || !runtime.docker || env.S3_BUCKET !== 'pero-crm-staging' || origin !== undefined && origin !== 'https://staging-crm.peromebel.by') fail();
  let proof: Record<string, unknown>;
  try { proof = JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF ?? 'null'); } catch { return fail(); }
  if (!proof || proof.hostname !== 'crm-staging' || typeof proof.web !== 'string' || !/^[a-f0-9]{64}$/.test(proof.web) || !proof.web.startsWith(runtime.hostname) ||
    typeof proof.database !== 'string' || !/^[a-f0-9]{64}$/.test(proof.database) || proof.databaseVolume !== 'crm-staging_pgdata' ||
    typeof proof.image !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(proof.image) || typeof proof.revision !== 'string' || !/^[a-f0-9]{40}$/.test(proof.revision) ||
    proof.revision !== env.CRM_KP_RECONCILIATION_REVISION) fail();
}
