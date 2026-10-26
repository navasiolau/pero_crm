import { RetentionError, assertRetentionTarget, sameRetentionBinding, type RetentionBinding, type RetentionClaim,
  type RetentionPayload, type RetentionProgress, type RetentionTarget, type StoredVersion } from "./retention-contract";

export type ListedVersion = { key: string; id: string; marker: boolean };
export type VersionCursor = { key: string; version?: string };
export interface RetentionStorage {
  currentBinding(): RetentionBinding;
  list(binding: RetentionBinding, key: string, cursor?: VersionCursor): Promise<{ entries: ListedVersion[]; next?: VersionCursor }>;
  digest(binding: RetentionBinding, key: string, versionId: string | null, maxBytes: number, signal?: AbortSignal): Promise<{ size: number; sha256: string } | null>;
  deleteVersion(binding: RetentionBinding, key: string, versionId: string | null): Promise<void>;
  head(binding: RetentionBinding, key: string): Promise<{ size: number } | null>;
}
export interface RetentionRepository {
  claim(owner: string, leaseMs: number, jobId?: string): Promise<RetentionClaim | null>;
  prepare(claim: RetentionClaim): Promise<{ payload: RetentionPayload; progress: RetentionProgress }>;
  guard(claim: RetentionClaim, target?: RetentionTarget): Promise<void>;
  discover(claim: RetentionClaim, target: RetentionTarget, versions: { id: string | null; marker: boolean }[]): Promise<StoredVersion[]>;
  deleteIntent(claim: RetentionClaim, target: RetentionTarget, version: StoredVersion): Promise<void>;
  deleted(claim: RetentionClaim, target: RetentionTarget, version: StoredVersion): Promise<void>;
  absent(claim: RetentionClaim, target: RetentionTarget, proof: { listedEmpty: true; headMissing: true; at: string }): Promise<void>;
  release(claim: RetentionClaim, target: RetentionTarget, available: boolean): Promise<void>;
  finish(claim: RetentionClaim): Promise<void>;
  fail(claim: RetentionClaim, error: RetentionError): Promise<void>;
  scheduleDue(limit: number, annual?: boolean): Promise<number>;
}
export type RetentionDependencies = { repository: RetentionRepository; storage: RetentionStorage;
  enabled: () => boolean; now?: () => Date; heartbeat?: (callback: () => void, milliseconds: number) => () => void };

async function checked(dependencies: RetentionDependencies, claim: RetentionClaim, target?: RetentionTarget) {
  if (!dependencies.enabled()) throw new RetentionError("KP_RETENTION_DISABLED", true);
  await dependencies.repository.guard(claim, target);
  if (target && !sameRetentionBinding(dependencies.storage.currentBinding(), target.binding)) throw new RetentionError("KP_RETENTION_STORAGE_CHANGED");
}
/** Тот же guard продлевает текущую lease и во время GET без новых chunks; проверки не перекрываются. */
async function digestWithLease(dependencies: RetentionDependencies, claim: RetentionClaim, target: RetentionTarget, versionId: string | null) {
  const controller = new AbortController(); let stopping = false, renewing: Promise<void> | undefined, guardFailed = false, guardError: unknown;
  const tick = () => {
    if (stopping || guardFailed || renewing) return;
    renewing = checked(dependencies, claim, target).catch(error => { guardFailed = true; guardError = error; controller.abort(error); }).finally(() => { renewing = undefined; });
  };
  const start = dependencies.heartbeat ?? ((callback: () => void, milliseconds: number) => { const timer = setInterval(callback, milliseconds); timer.unref?.(); return () => clearInterval(timer); });
  const stop = start(tick, 20_000); let value: { size: number; sha256: string } | null = null, failed = false, failure: unknown;
  try { value = await dependencies.storage.digest(target.binding, target.key, versionId, target.size, controller.signal); }
  catch (error) { failed = true; failure = error; }
  finally { stopping = true; stop(); controller.abort(); await renewing; }
  if (guardFailed) throw guardError;
  if (failed) throw failure;
  await checked(dependencies, claim, target); return value;
}
async function exactVersions(dependencies: RetentionDependencies, claim: RetentionClaim, target: RetentionTarget) {
  const rows = new Map<string, ListedVersion>(), cursors = new Set<string>(); let cursor: VersionCursor | undefined;
  for (let page = 0; page < 100; page++) {
    await checked(dependencies, claim, target);
    const result = await dependencies.storage.list(target.binding, target.key, cursor);
    for (const row of result.entries) {
      if (row.key !== target.key) continue;
      if (!row.id || row.id.length > 1024 || !rows.has(row.id) && rows.size >= 1000) throw new RetentionError("KP_RETENTION_VERSION_INVALID");
      rows.set(row.id, row);
    }
    if (!result.next) return [...rows.values()];
    const value = JSON.stringify(result.next);
    if (!result.next.key || result.next.key===target.key&&!result.next.version || cursors.has(value)) throw new RetentionError("KP_RETENTION_CURSOR_INVALID");
    cursors.add(value); cursor = result.next;
  }
  throw new RetentionError("KP_RETENTION_PAGE_LIMIT");
}

/** Каждый Delete получает durable exact-version intent; удаление префикса отсутствует в интерфейсе. */
export async function executeProposalRetention(dependencies: RetentionDependencies, claim: RetentionClaim): Promise<void> {
  await checked(dependencies, claim);
  const { payload, progress } = await dependencies.repository.prepare(claim);
  let unresolvedProbe=false;
  for (const target of progress.manifest.targets) {
    assertRetentionTarget(claim.proposalId, target);
    if (progress.objects[target.id]?.absentAt || progress.objects[target.id]?.releasedAt) continue;
    if (payload.kind === "CANCELLED_PROBE") {
      const changed = progress.objects[target.id]?.versions.some(version => version.phase !== "DISCOVERED");
      if (!changed) { await dependencies.repository.release(claim, target, true); continue; }
      const versions = await exactVersions(dependencies, claim, target);
      const known = progress.objects[target.id]?.versions ?? [];
      for (const version of known) if (version.phase === "INTENT" && version.id !== null && !versions.some(current => current.id === version.id)) {
        await dependencies.repository.deleted(claim,target,version); version.phase="DELETED";
      }
      const unknownRequest = known.some(version=>version.phase==='INTENT');
      await checked(dependencies, claim, target);
      const head = await dependencies.storage.head(target.binding, target.key);
      if (!head && !versions.length) await dependencies.repository.absent(claim, target, { listedEmpty: true, headMissing: true, at: (dependencies.now?.() ?? new Date()).toISOString() });
      else if (head) {
        await checked(dependencies, claim, target);
        const actual = await digestWithLease(dependencies, claim, target, null);
        if (!actual || actual.size !== target.size || actual.sha256 !== target.sha256) throw new RetentionError("KP_RETENTION_CHECKSUM_CHANGED");
        await dependencies.repository.release(claim, target, !unknownRequest);unresolvedProbe ||= unknownRequest;
      } else {await dependencies.repository.release(claim, target, false);unresolvedProbe=true;} // Marker не доказывает физическое отсутствие.
      continue;
    }
    let absent = false;
    for (let sweep = 0; sweep < 4; sweep++) {
      const listed = await exactVersions(dependencies, claim, target);
      const discovered: { id: string | null; marker: boolean }[] = listed.map(row => ({ id: row.id, marker: row.marker }));
      if (!listed.length) {
        await checked(dependencies, claim, target);
        if (await dependencies.storage.head(target.binding, target.key)) discovered.push({ id: null, marker: false });
      }
      const versions = await dependencies.repository.discover(claim, target, discovered);
      for (const version of versions) {
        if (version.phase === "DELETED") continue;
        await checked(dependencies, claim, target);
        if (!version.marker) {
          const actual = await digestWithLease(dependencies, claim, target, version.id);
          if (actual && (actual.size !== target.size || actual.sha256 !== target.sha256)) throw new RetentionError("KP_RETENTION_CHECKSUM_CHANGED");
          if (!actual) { await dependencies.repository.deleted(claim, target, version); continue; }
        }
        await dependencies.repository.deleteIntent(claim, target, version);
        await checked(dependencies, claim, target);
        await dependencies.storage.deleteVersion(target.binding, target.key, version.id);
        // ACK остаётся фактом даже при отмене/потере lease в уже начатом сетевом запросе.
        await dependencies.repository.deleted(claim, target, version);
      }
      const remaining = await exactVersions(dependencies, claim, target);
      if (remaining.length) continue;
      await checked(dependencies, claim, target);
      if (await dependencies.storage.head(target.binding, target.key)) continue;
      await dependencies.repository.absent(claim, target, { listedEmpty: true, headMissing: true, at: (dependencies.now?.() ?? new Date()).toISOString() });
      absent = true; break;
    }
    if (!absent) throw new RetentionError("KP_RETENTION_OBJECT_REMAINS", true);
  }
  if(unresolvedProbe)throw new RetentionError('KP_RETENTION_PROBE_UNRESOLVED',true);
  await checked(dependencies, claim);
  await dependencies.repository.finish(claim);
}
