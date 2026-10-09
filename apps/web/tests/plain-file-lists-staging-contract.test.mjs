import assert from 'node:assert/strict';
import test from 'node:test';
import {openOwnedTaskFileDialog, plainFileListPageErrorDiagnostic, fileListsDesktopPrefixAccepted, fileListsUnlinkedTaskOmitted} from './plain-file-lists-staging-browser.mjs';
import {createHash} from 'node:crypto';
import {FILE_LIST_STAGING_ORIGIN as origin, FILE_LIST_FIXTURE_NAMESPACE as namespace, compiledDeleteFileActionId, verifyPlainFileListStagingBinding, plainFileListRequestDecision, plainFileDeleteFlightOutcome, createPlainFileListDeleteGate, createPlainFileListOwnerLedger, plainFileListSafeError} from './plain-file-lists-staging-contract.mjs';
const runId = 'a1111111-1111-4111-8111-111111111111', revision = 'a'.repeat(40), actionId = 'b'.repeat(42);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture() {
 const actors = Object.fromEntries([['manager', 'MANAGER'], ['admin', 'ADMIN'], ['engineer', 'ENGINEER']].map(([name, role]) => [name, {id: `qa-${name}`, roles: [role], sessionVersion: 1}]));
 const file = (id, section, uploadedById, extra = {}) => ({id, section, uploadedById, fileName: `QA113-${runId}-${id}.png`, mimeType: 'image/png', projectId: 'qa-project', productId: 'qa-product', taskId: null, contentHash: 'c'.repeat(64), versionSetHash: 'd'.repeat(64), ...extra});
 const handoff = {namespace, kind: 'handoff', runId, revision, preSha256: 'e'.repeat(64), checkpointHash: 'f'.repeat(64), signature: '1'.repeat(64), currentOwnedStateHash: '5'.repeat(64), storageManifestHash: '6'.repeat(64), financialStateHash: '7'.repeat(64), actors,
  ids: {project: 'qa-project', product: 'qa-product', task: 'qa-task'}, paths: {project: '/projects/qa-project', product: '/products/QA113.1', financeProject: '/finance/projects/qa-project'}, productNumber: 'QA113.1', taskTitle: `QA113-${runId}-task`, currentSketchFileId: 'qa-sketch', currentProjectCoverFileId: null,
  files: [file('qa-sketch', 'PRODUCTION', actors.admin.id), file('qa-foreign', 'PRODUCTION', actors.admin.id), file('qa-engineer', 'MEASUREMENT', actors.engineer.id), file('qa-task-file', 'GENERAL', actors.manager.id, {taskId: 'qa-task'}), file('qa-pdf', 'PRODUCTION', actors.admin.id, {mimeType: 'application/pdf', fileName: `QA113-${runId}.pdf`}), file('qa-project-file', 'GENERAL', actors.manager.id, {productId: null})],
  finance: {accountId: 'qa-account', articleId: 'qa-article', incomeId: 'qa-income', expenseId: 'qa-expense', accountName: `QA113-${runId}-cash`, incomeComment: `QA113-${runId}-income`, expenseComment: `QA113-${runId}-expense`, date: '2026-10-09', currency: 'BYN', incomeAmount: '2', expenseAmount: '1', rate: '1'},
  financeDocs: [{id: 'qa-finance', uploadedById: actors.admin.id, status: 'READY', fileName: `QA113-${runId}-finance.pdf`, mimeType: 'application/pdf', paymentId: 'qa-expense', contentHash: '2'.repeat(64), versionSetHash: '3'.repeat(64)}]};
 const profiles = Object.fromEntries(Object.entries(actors).map(([name, actor]) => [name, {...actor, cookies: [{name: '__Secure-authjs.session-token', value: `synthetic-memory-only-${name}`, url: origin, httpOnly: true, secure: true}]}]));
 handoff.rawManifestSha256 = '8'.repeat(64);handoff.actionManifestHash = 'a'.repeat(64);handoff.compiledDeleteFile = {id: actionId, exportedName: 'deleteFile', source: 'src/server/files/actions.ts', routes: ['/products/[id]', '/projects/[id]'], revision, rawManifestSha256: handoff.rawManifestSha256, actionManifestHash: handoff.actionManifestHash};
 const sourceSha256 = '4'.repeat(64);
 return {authorized: true, origin, expectedRevision: revision, identity: {hostname: 'crm-staging', revision}, handoff, profiles,
  fixtureVerifier: {sourceSha256, verifySignedFixture: async ({handoff: h, actionManifestHash, rawManifestSha256, compiledDeleteFileHash}) => ({kind: 'current-owned-fixture-verification', namespace, verifierSourceSha256: sourceSha256, runId: h.runId, revision: h.revision, preSha256: h.preSha256, checkpointHash: h.checkpointHash, actionManifestHash, rawManifestSha256, compiledDeleteFileHash, currentOwnedStateHash: '5'.repeat(64), storageManifestHash: '6'.repeat(64), financialStateHash: '7'.repeat(64)})}};
}
const read = (path, method = 'GET', extra = {}) => ({url: origin + path, method, ...extra});
const request = (binding, path = binding.paths.product, id = 'qa-engineer') => read(path, 'POST', {actionId, body: JSON.stringify([id])});
function ledger(binding, patch = {}) {
 const history = [], callbacks = {persistPreIntent: async intent => {history.push(['preintent', intent]);return {recorded: true, expectedStateHash: intent.expectedStateHash, sequence: intent.sequence};},
  observeOwnedState: async intent => {history.push(['observation', intent]);return {verified: true, previousStateHash: intent.expectedStateHash, stateHash: '8'.repeat(64), filePresent: intent.outcome === 'acknowledged-refusal', storageVersionsAccounted: true, financialStateHash: binding.financialStateHash, tokenClockValid: true};},
  persistAcknowledgement: async intent => {history.push(['ack', intent]);return {recorded: true, sequence: intent.sequence, stateHash: intent.stateHash};}, ...patch};
 return {history, callbacks, gate: createPlainFileListDeleteGate(binding, callbacks)};
}
const goodResponse = () => ({status: 200, contentType: 'text/x-component', redirected: false, body: Buffer.from('0:{"ok":true}\n')});

test('current signed owner verifier and physical full SHA bind own roles, derived paths and copied memory-only cookies', async () => {
 const input = fixture(), before = JSON.stringify(input), binding = await verifyPlainFileListStagingBinding(input);
 assert.equal(binding.paths.product, '/products/QA113.1');assert.equal(binding.profiles.engineer.id, 'qa-engineer');assert.equal(binding.profiles.manager.cookies[0].secure, true);
 assert.equal(JSON.stringify(input), before);assert.notEqual(binding.profiles.admin.cookies[0], input.profiles.admin.cookies[0]);
 assert.equal(binding.files[0].storageKey, undefined);assert.equal(binding.files[0].uploadedByName, undefined);
});

test('a boolean verifier historical certificate or different compiled manifest cannot authorize a browser', async () => {
 for (const change of [value => value.fixtureVerifier.verifySignedFixture = async () => true,
  value => value.fixtureVerifier.verifySignedFixture = async () => ({kind: 'prepared'}),
  value => value.fixtureVerifier.verifySignedFixture = async args => ({...(await fixture().fixtureVerifier.verifySignedFixture(args)), actionManifestHash: hash({other: true})}),
  value => value.fixtureVerifier.sourceSha256 = 'wrong', value => value.fixtureVerifier = undefined]) {
  const input = fixture();change(input);await assert.rejects(verifyPlainFileListStagingBinding(input), /^Error: F115_/);
 }
});

test('foreign physical target SHA actors current-scope files paths and cookie domains fail closed', async () => {
 for (const change of [value => value.authorized = false, value => value.origin = 'https://crm.peromebel.by', value => value.identity.hostname = 'crm-prod', value => value.identity.revision = '9'.repeat(40), value => value.handoff.runId = 'invalid', value => value.handoff.actors.admin.id = 'existing-user', value => value.profiles.engineer.roles = ['MANAGER'], value => value.handoff.paths.product = '/products/other', value => value.handoff.files[1].projectId = 'other', value => value.handoff.files[1].uploadedById = 'existing-user', value => value.handoff.files[1].versionSetHash = 'wrong', value => value.profiles.admin.cookies[0].domain = 'crm.peromebel.by', value => value.handoff.financeDocs[0].paymentId = 'other-payment']) {
  const input = fixture();change(input);await assert.rejects(verifyPlainFileListStagingBinding(input), /^Error: F115_/);
 }
});

test('only the signed public compiled deleteFile descriptor current SHA canonical source and exact actual-worker templates are accepted', () => {
 const descriptor = fixture().handoff.compiledDeleteFile;assert.equal(compiledDeleteFileActionId(descriptor, revision), actionId);
 for (const value of [{}, {...descriptor, id: 'bad'}, {...descriptor, exportedName: 'deletePayment'}, {...descriptor, source: 'server/files/actions.ts'}, {...descriptor, revision: '0'.repeat(40)}, {...descriptor, routes: ['/products/[id]']}, {...descriptor, routes: ['/products/[id]', '/projects/[id]', '/other']}, {...descriptor, encryptionKey: 'PRIVATE'}, {...descriptor, rawManifestSha256: 'bad'}]) assert.throws(() => compiledDeleteFileActionId(value, revision), /^Error: F115_/);
});

test('own detail GET/HEAD and own protected originals previews finance docs exact report period and static chunks are allowed', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture());
 for (const path of ['/api/health', '/api/auth/session', binding.paths.product, binding.paths.project + '?tab=files', binding.paths.project + '?tab=tasks', binding.paths.financeProject, '/finance/expenses', '/finance/income', '/finance/accounts/report?from=2026-10-09&to=2026-10-09&mode=BYN', '/api/files/qa-engineer', '/api/files/qa-sketch?preview=cover', '/api/finance/documents/qa-finance', '/_next/static/chunks/qa.js']) for (const method of ['GET', 'HEAD']) assert.equal(plainFileListRequestDecision(read(path, method), binding).kind, 'continue');
});

test('unowned media exports library redirects arbitrary query proxy and all unarmed writes are blocked', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture());
 for (const path of ['/products', '/projects/other', '/api/files/other?preview=card', '/api/finance/documents/other', '/api/files/qa-engineer?view=1', '/api/files/qa-engineer?preview=cover&preview=thumbnail', '/finance/documents', '/finance/accounts/report?from=2026-10-01', '/finance/accounts/export', '/_next/image?url=/api/files/other', binding.paths.product + '?client=other']) assert.equal(plainFileListRequestDecision(read(path), binding).kind, 'deny');
 assert.equal(plainFileListRequestDecision({url: 'https://crm.peromebel.by/api/files/qa-engineer', method: 'GET'}, binding).kind, 'deny');
 for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(plainFileListRequestDecision(read('/api/files/upload', method), binding).kind, 'abort-write');
 assert.equal(plainFileListRequestDecision(read(binding.paths.product, 'POST', {actionId: 'other', body: '[]'}), binding).kind, 'abort-write');
 assert.equal(plainFileListRequestDecision(read(binding.paths.product, 'GET', {prefetch: true}), binding).kind, 'abort-prefetch');
});

test('Flight extracts one real compact result without exporting private errors or accepting ambiguity', () => {
 assert.deepEqual(plainFileDeleteFlightOutcome(Buffer.from('0:{"ok":false,"error":"PRIVATE_REASON"}\n')), {ok: false});
 for (const bytes of ['0:{"ok":true}\n1:{"ok":false}', '0:{"other":true}', '0:{"ok":true,"payoutId":"other"}']) assert.throws(() => plainFileDeleteFlightOutcome(Buffer.from(bytes)), /^Error: F115_/);
 assert.equal(plainFileListSafeError(Error('PRIVATE_TOKEN')), 'F115_CHECK_FAILED');
});

test('permission and action args cannot expand beyond one own non-cover file and selected actor', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture()), {gate} = ledger(binding);
 for (const intent of [{fileId: 'qa-sketch', actor: 'manager', path: binding.paths.product}, {fileId: 'qa-finance', actor: 'admin', path: binding.paths.product}, {fileId: 'qa-foreign', actor: 'engineer', path: binding.paths.product}, {fileId: 'other', actor: 'manager', path: binding.paths.project}, {fileId: 'qa-engineer', actor: 'engineer', path: '/products/other'}]) assert.throws(() => gate.arm(intent), /^Error: F115_/);
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product});
 for (const bad of [{...request(binding), body: JSON.stringify(['qa-engineer', 'other'])}, request(binding, binding.paths.product, 'other'), request(binding, binding.paths.project)]) assert.throws(() => gate.consume(bad, 'engineer'), /^Error: F115_/);
 assert.throws(() => gate.consume(request(binding), 'manager'), /^Error: F115_/);
});

test('durable preintent precedes exactly one upstream action, then current CAS and durable ACK precede UI fulfillment', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture()), {gate, history} = ledger(binding);
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product});const intent = gate.consume(request(binding), 'engineer');
 const result = await gate.execute(intent, async () => {history.push(['upstream']);return goodResponse();});
 assert.deepEqual(result, {kind: 'acknowledged', ok: true});assert.deepEqual(history.map(row => row[0]), ['preintent', 'upstream', 'observation', 'ack']);
 await assert.rejects(gate.execute(intent, async () => {throw Error('RETRY_FORBIDDEN');}), /^Error: F115_/);assert.throws(() => gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product}), /^Error: F115_/);gate.assertUnarmed();
});

test('pending confirmation blocks a second operation before the async durable preintent completes', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture());let release, upstream = 0;
 const held = new Promise(resolve => {release = resolve;});
 const {gate} = ledger(binding, {persistPreIntent: async intent => {await held;return {recorded: true, expectedStateHash: intent.expectedStateHash, sequence: intent.sequence};}});
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product});const intent = gate.consume(request(binding), 'engineer'), pending = gate.execute(intent, async () => {upstream++;return goodResponse();});
 await assert.rejects(gate.execute(intent, async () => {upstream++;return goodResponse();}), /^Error: F115_/);
 assert.throws(() => gate.arm({fileId: 'qa-task-file', actor: 'manager', path: binding.paths.product}), /^Error: F115_/);
 release();await pending;assert.equal(upstream, 1);
});

test('local client failure has zero ledger or upstream operations and is consumed without retry', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture()), {gate, history} = ledger(binding);
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product, mode: 'client-error'});const intent = gate.consume(request(binding), 'engineer');
 assert.deepEqual(await gate.execute(intent, async () => {throw Error('UPSTREAM_FORBIDDEN');}), {kind: 'abort-client-error'});assert.deepEqual(history, []);
 await assert.rejects(gate.execute(intent, goodResponse), /^Error: F115_/);
});

test('a missing durable preintent never sends upstream and stops future actions', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture()), {gate} = ledger(binding, {persistPreIntent: async () => ({recorded: false})});let sent = 0;
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product});const intent = gate.consume(request(binding), 'engineer');
 await assert.rejects(gate.execute(intent, async () => {sent++;return goodResponse();}), /F115_PREINTENT_NOT_DURABLE/);assert.equal(sent, 0);assert.throws(() => gate.assertUnarmed(), /^Error: F115_/);
});

test('lost ACK, redirects or unrelated financial/CAS changes reconcile the preintent and STOP without a retry', async () => {
 for (const variant of ['lost', 'redirect', 'finance', 'presence', 'clock', 'ack']) {
  const binding = await verifyPlainFileListStagingBinding(fixture()), patch = {};
  if (['finance', 'presence', 'clock'].includes(variant)) patch.observeOwnedState = async intent => ({verified: true, previousStateHash: intent.expectedStateHash, stateHash: '8'.repeat(64), filePresent: variant === 'presence', storageVersionsAccounted: true, financialStateHash: variant === 'finance' ? '9'.repeat(64) : binding.financialStateHash, tokenClockValid: variant !== 'clock'});
  if (variant === 'ack') patch.persistAcknowledgement = async () => ({recorded: false});
  const {gate, history} = ledger(binding, patch);gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product});const intent = gate.consume(request(binding), 'engineer');let sent = 0;
  await assert.rejects(gate.execute(intent, async () => {sent++;if (variant === 'lost') throw Error('PRIVATE_COOKIE');return {...goodResponse(), redirected: variant === 'redirect'};}), /^Error: F115_/);
  assert.equal(sent, 1);assert.equal(history[0][0], 'preintent');assert.throws(() => gate.assertUnarmed(), /^Error: F115_/);
 }
});
test('private owner verifier exceptions are sanitized before browser setup', async () => {
 const input = fixture();input.fixtureVerifier.verifySignedFixture = async () => {throw Error('PRIVATE_SESSION_TOKEN');};
 await assert.rejects(verifyPlainFileListStagingBinding(input), /^Error: F115_OWNER_VERIFICATION_REJECTED$/);
});

test('issued delete intent is immutable and a forged copy cannot reach the ledger or upstream', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture()), {gate, history} = ledger(binding);
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product});const intent = gate.consume(request(binding), 'engineer');
 assert.throws(() => {intent.actorId = 'existing-user';}, TypeError);
 await assert.rejects(gate.execute({...intent}, async () => {throw Error('UPSTREAM_FORBIDDEN');}), /^Error: F115_DELETE_STATE_CHANGED$/);assert.deepEqual(history, []);
});

test('a STOP during durable preintent persistence cannot proceed to upstream after the await', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture());let release, sent = 0;const held = new Promise(resolve => {release = resolve;});
 const {gate} = ledger(binding, {persistPreIntent: async intent => {await held;return {recorded: true, expectedStateHash: intent.expectedStateHash, sequence: intent.sequence};}});
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: binding.paths.product});const intent = gate.consume(request(binding), 'engineer');const operation = gate.execute(intent, async () => {sent++;return goodResponse();});
 gate.stop();release();await assert.rejects(operation, /F115_STOP_BEFORE_UPSTREAM/);assert.equal(sent, 0);
});
function producerHash(value) {
 const canonical = item => Array.isArray(item) ? `[${item.map(canonical).join(',')}]` : item && typeof item === 'object' ? `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}` : JSON.stringify(item);
 return createHash('sha256').update(canonical(value)).digest('hex');
}
async function producerLedgerFixture() {
 const input = fixture(), h = input.handoff, calls = [];
 const files = h.files.map(file => ({...file, storedName: `${file.id}.bin`, hasThumb: false}));
 const rows = {File: files, ChangeLog: [{id: 'old-audit', entity: 'file', action: 'create'}], UserPreference: [], Payment: [{id: 'qa-income'}, {id: 'qa-expense'}]};
 const storage = files.map(file => ({key: `${file.projectId}/${file.storedName}`, versionId: `v-${file.id}`, deleteMarker: false, latest: true, size: 4, etag: 'QA'}));
 h.currentOwnedStateHash = producerHash(rows);h.storageManifestHash = producerHash(storage);
 h.files.forEach(file => {file.versionSetHash = producerHash(storage.filter(row => row.key === `${file.projectId}/${file.id}.bin`));});
 const oldVerifier = input.fixtureVerifier.verifySignedFixture;
 input.fixtureVerifier.verifySignedFixture = async args => ({...await oldVerifier(args), currentOwnedStateHash: h.currentOwnedStateHash, storageManifestHash: h.storageManifestHash});
 const binding = await verifyPlainFileListStagingBinding(input);
 let currentRows = structuredClone(rows), currentStorage = structuredClone(storage), finalPatch = {}, prePatch = {}, ackPatch = {}, partialPre = null;
 const envelope = (kind, fields) => ({namespace, kind, runId, revision, preSha256: h.preSha256, signature: '9'.repeat(64), ...fields});
 const observation = () => envelope('observation', {rows: currentRows, storage: currentStorage, currentOwnedStateHash: producerHash(currentRows), storageManifestHash: producerHash(currentStorage), financialStateHash: binding.financialStateHash, originalVerification: {originalRelationsMatch: true, preferencesUntouched: true, tokenClockValid: true}});
 const coordinator = {
  state: () => ({sourceHashes: {'file-fixture113-entry.mjs': input.fixtureVerifier.sourceSha256}}),
  async preDelete({fileId, actorKey}) {
   calls.push('preDelete-durable');const result = envelope('delete-intent', {fileId, actorId: binding.profiles[actorKey].id, observation: observation(), expectedOwnStateHash: producerHash(currentRows), expectedStorageManifestHash: producerHash(currentStorage), ...prePatch});if (partialPre) await partialPre;return result;
  },
  async afterDelete(intent, {cancelled}) {
   calls.push('afterDelete-durable');
   if (!cancelled) {const file = currentRows.File.find(row => row.id === intent.fileId);currentRows = {...currentRows, File: currentRows.File.filter(row => row.id !== intent.fileId), ChangeLog: [...currentRows.ChangeLog, {id: 'new-delete-audit', entity: 'file', action: 'delete', entityId: intent.fileId, actorId: intent.actorId}]};currentStorage = currentStorage.map(row => row.key === `${file.projectId}/${file.storedName}` ? {...row, latest: false} : row);currentStorage.push({key: `${file.projectId}/${file.storedName}`, versionId: 'own-delete-marker', deleteMarker: true, latest: true, size: null, etag: null});}
   return envelope('delete-ack', {intentSha256: producerHash(intent), observation: observation(), verification: {versionsAccounted: true, priorOwnAuditPreserved: true, ownPreferencesUntouched: true, ...(cancelled ? {cancelled: true} : {deleted: true, auditId: 'new-delete-audit'})}, ...ackPatch});
  },
  async observe() {calls.push('late-observe');return observation();},
  async verifyFinalState() {calls.push('final-state');const current = observation();return envelope('current-owned-final-verification', {checkpointHash: binding.checkpointHash, verifierSourceSha256: binding.verifierSourceSha256, currentOwnedStateHash: current.currentOwnedStateHash, storageManifestHash: current.storageManifestHash, financialStateHash: binding.financialStateHash, untouchedRelationsMatch: true, preferencesUntouched: true, storageVersionsAccounted: true, tokenClockValid: true, ...finalPatch});},
 };
 return {binding, coordinator, calls, patchPre(value) {prePatch = value;}, patchAck(value) {ackPatch = value;}, patchFinal(value) {finalPatch = value;}, holdPre(value) {partialPre = value;}};
}
const finalInput = (binding, stateHash) => ({runId: binding.runId, revision: binding.expectedRevision, preSha256: binding.preSha256, checkpointHash: binding.checkpointHash, expectedOwnedStateHash: stateHash, acknowledgedDeletes: 1});

test('producer adapter bridges durable signed intent real Flight signed observation ACK and final state without editing signed metadata', async () => {
 const f = await producerLedgerFixture(), owner = createPlainFileListOwnerLedger(f.binding, f.coordinator), gate = createPlainFileListDeleteGate(f.binding, owner);
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: f.binding.paths.product});const intent = gate.consume(request(f.binding), 'engineer');
 const result = await gate.execute(intent, async () => {f.calls.push('actual-upstream');return goodResponse();});assert.equal(result.ok, true);
 assert.deepEqual(f.calls, ['preDelete-durable', 'actual-upstream', 'afterDelete-durable']);
 const final = await owner.verifyFinalState(finalInput(f.binding, gate.currentStateHash()));assert.equal(final.untouchedRelationsMatch, true);assert.deepEqual(f.calls, ['preDelete-durable', 'actual-upstream', 'afterDelete-durable', 'final-state']);
});

test('producer source pin stale pre-state and changed per-file version set refuse the request before upstream', async () => {
 for (const variant of ['source', 'state', 'versions', 'actor']) {
  const f = await producerLedgerFixture();if (variant === 'source') f.coordinator.state = () => ({sourceHashes: {'file-fixture113-entry.mjs': '0'.repeat(64)}});
  if (variant === 'source') {assert.throws(() => createPlainFileListOwnerLedger(f.binding, f.coordinator), /F115_COORDINATOR_SOURCE_MISMATCH/);continue;}
  if (variant === 'state') f.patchPre({expectedOwnStateHash: '0'.repeat(64)});if (variant === 'actor') f.patchPre({actorId: 'existing-user'});
  const owner = createPlainFileListOwnerLedger(f.binding, f.coordinator), gate = createPlainFileListDeleteGate(f.binding, owner);gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: f.binding.paths.product});const intent = gate.consume(request(f.binding), 'engineer');let sent = 0;
  if (variant === 'versions') {const original = f.coordinator.preDelete;f.coordinator.preDelete = async args => {const value = await original(args);value.observation.storage[2].versionId = 'changed-version';value.observation.storageManifestHash = producerHash(value.observation.storage);value.expectedStorageManifestHash = value.observation.storageManifestHash;return value;};}
  await assert.rejects(gate.execute(intent, async () => {sent++;return goodResponse();}), /^Error: F115_/);assert.equal(sent, 0);
 }
});

test('producer adapter reserves one outstanding intent synchronously while durable publishing is pending', async () => {
 const f = await producerLedgerFixture();let release;f.holdPre(new Promise(resolve => {release = resolve;}));const owner = createPlainFileListOwnerLedger(f.binding, f.coordinator), gate = createPlainFileListDeleteGate(f.binding, ledger(f.binding).callbacks);
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: f.binding.paths.product});const intent = gate.consume(request(f.binding), 'engineer');const preparing = owner.persistPreIntent(intent);
 await assert.rejects(owner.persistPreIntent({...intent, sequence: 2}), /F115_PRODUCER_PREINTENT_SCOPE_MISMATCH/);release();assert.equal((await preparing).recorded, true);assert.deepEqual(f.calls, ['preDelete-durable']);
});

test('producer refusal ACK proves present rows and preserved prior audit/preferences rather than a deleted outcome', async () => {
 const f = await producerLedgerFixture(), owner = createPlainFileListOwnerLedger(f.binding, f.coordinator), gate = createPlainFileListDeleteGate(f.binding, owner);
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: f.binding.paths.product});const intent = gate.consume(request(f.binding), 'engineer');
 const result = await gate.execute(intent, async () => ({...goodResponse(), body: Buffer.from('0:{"ok":false,"error":"PRIVATE_REFUSAL"}\n')}));assert.equal(result.ok, false);
 const final = await owner.verifyFinalState(finalInput(f.binding, gate.currentStateHash()));assert.equal(final.currentOwnedStateHash, f.binding.currentOwnedStateHash);assert.deepEqual(f.calls, ['preDelete-durable', 'afterDelete-durable', 'final-state']);
});

test('producer ACK without exact signed-intent hash prior audit/prefs or original invariants cannot be promoted to UI success', async () => {
 for (const variant of ['intentHash', 'audit', 'prefs', 'original']) {
  const f = await producerLedgerFixture();if (variant === 'intentHash') f.patchAck({intentSha256: '0'.repeat(64)});
  else {const original = f.coordinator.afterDelete;f.coordinator.afterDelete = async (...args) => {const ack = await original(...args);if (variant === 'audit') ack.verification.priorOwnAuditPreserved = false;if (variant === 'prefs') ack.verification.ownPreferencesUntouched = false;if (variant === 'original') ack.observation.originalVerification.originalRelationsMatch = false;return ack;};}
  const gate = createPlainFileListDeleteGate(f.binding, createPlainFileListOwnerLedger(f.binding, f.coordinator));gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: f.binding.paths.product});const intent = gate.consume(request(f.binding), 'engineer');
  await assert.rejects(gate.execute(intent, goodResponse), /^Error: F115_/);assert.ok(f.calls.includes('late-observe'));assert.throws(() => gate.assertUnarmed(), /^Error: F115_/);
 }
});

test('unknown producer outcome captures only a late observation and never invents cancelled ACK or automatic retry', async () => {
 const f = await producerLedgerFixture(), owner = createPlainFileListOwnerLedger(f.binding, f.coordinator), gate = createPlainFileListDeleteGate(f.binding, owner);gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: f.binding.paths.product});const intent = gate.consume(request(f.binding), 'engineer');
 await assert.rejects(gate.execute(intent, async () => {f.calls.push('lost-upstream');throw Error('PRIVATE_BODY');}), /^Error: F115_/);assert.deepEqual(f.calls, ['preDelete-durable', 'lost-upstream', 'late-observe']);
 await assert.rejects(owner.verifyFinalState(finalInput(f.binding, gate.currentStateHash())), /F115_PRODUCER_FINAL_CAS_REQUIRED/);
});

test('signed handoff current own storage and finance hashes must exactly match the current producer certificate', async () => {
 for (const field of ['currentOwnedStateHash', 'storageManifestHash', 'financialStateHash']) {const input = fixture();input.handoff[field] = '0'.repeat(64);await assert.rejects(verifyPlainFileListStagingBinding(input), /F115_CURRENT_OWNER_VERIFICATION_REQUIRED/);}
});
test('client-error consumes a UI sequence without a producer write and the next real sequence still binds to the original CAS', async () => {
 const f = await producerLedgerFixture(), owner = createPlainFileListOwnerLedger(f.binding, f.coordinator), gate = createPlainFileListDeleteGate(f.binding, owner);
 gate.arm({fileId: 'qa-pdf', actor: 'manager', path: f.binding.paths.product, mode: 'client-error'});const aborted = gate.consume(request(f.binding, f.binding.paths.product, 'qa-pdf'), 'manager');
 assert.equal((await gate.execute(aborted, async () => {throw Error('UPSTREAM_FORBIDDEN');})).kind, 'abort-client-error');assert.deepEqual(f.calls, []);
 gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: f.binding.paths.product});const actual = gate.consume(request(f.binding), 'engineer');assert.equal(actual.sequence, 2);
 assert.equal((await gate.execute(actual, goodResponse)).ok, true);assert.deepEqual(f.calls, ['preDelete-durable', 'afterDelete-durable']);
});
test('current producer certificate binds public descriptor raw manifest and canonical descriptor hashes before cookies or browser setup', async () => {
 for (const field of ['rawManifestSha256', 'compiledDeleteFileHash']) {const input = fixture(), original = input.fixtureVerifier.verifySignedFixture;input.fixtureVerifier.verifySignedFixture = async args => ({...await original(args), [field]: '0'.repeat(64)});await assert.rejects(verifyPlainFileListStagingBinding(input), /F115_CURRENT_OWNER_VERIFICATION_REQUIRED/);}
 const input = fixture();input.handoff.rawManifestSha256 = '0'.repeat(64);await assert.rejects(verifyPlainFileListStagingBinding(input), /F115_SIGNED_MANIFEST_PROVENANCE_MISMATCH/);
});
test('producer final proof rejects unrelated original/preferences/financial changes and unaccounted native S3 versions', async () => {
 for (const patch of [{untouchedRelationsMatch: false}, {preferencesUntouched: false}, {financialStateHash: '0'.repeat(64)}, {storageVersionsAccounted: false}, {tokenClockValid: false}]) {
  const f = await producerLedgerFixture(), owner = createPlainFileListOwnerLedger(f.binding, f.coordinator), gate = createPlainFileListDeleteGate(f.binding, owner);gate.arm({fileId: 'qa-engineer', actor: 'engineer', path: f.binding.paths.product});const intent = gate.consume(request(f.binding), 'engineer');await gate.execute(intent, goodResponse);f.patchFinal(patch);
  await assert.rejects(owner.verifyFinalState(finalInput(f.binding, gate.currentStateHash())), /F115_PRODUCER_FINAL_PROOF_MISMATCH/);
 }
});

test('owned task OPEN accepts heading status badge and only retries a hidden hydration timeout', async () => {
 const title = 'QA(task).1+ [files]';
 function surface({opensAfter = 1, count = 1, waitError = null, visibleOnError = false} = {}) {
  let clicks = 0, visible = false;
  const trigger = {count: async () => count, isVisible: async () => true, click: async options => {assert.deepEqual(options, {timeout: 65000});visible = ++clicks >= opensAfter;}};
  const dialog = {filter(options) {assert.equal(options.has.kind, 'owned-heading');return this;}, count: async () => visible ? 1 : 0, isVisible: async () => visible, waitFor: async options => {
   assert.deepEqual(options, {state: 'visible', timeout: 2500});
   if (waitError) {visible = visibleOnError;const error = Error('controlled');error.name = waitError;throw error;}
   if (!visible) {const error = Error('controlled');error.name = 'TimeoutError';throw error;}
  }};
  const page = {getByText: (value, options) => {assert.equal(value, title);assert.deepEqual(options, {exact: true});return trigger;}, getByRole: (role, options) => {
   if (role === 'dialog') return dialog;
   assert.equal(role, 'heading');assert.equal(options.name.test(title + ' Новая'), true);assert.equal(options.name.test(title), true);assert.equal(options.name.test(title + '-foreign'), false);assert.equal(options.name.test('QAxtaskx.1+ [files] Новая'), false);return {kind: 'owned-heading'};
  }};
  return {page, dialog, clicks: () => clicks};
 }
 for (const opensAfter of [1, 2, Infinity]) {
  const s = surface({opensAfter}), attempts = [];
  if (Number.isFinite(opensAfter)) {assert.equal(await openOwnedTaskFileDialog(s.page, title, attempt => attempts.push(attempt)), s.dialog);assert.equal(s.clicks(), opensAfter);assert.equal(attempts.length, opensAfter);}
  else {await assert.rejects(openOwnedTaskFileDialog(s.page, title), /F115_TASK_DIALOG_NOT_VISIBLE/);assert.equal(s.clicks(), 3);}
 }
 for (const settings of [{waitError: 'Error'}, {waitError: 'TimeoutError', visibleOnError: true}, {count: 2}]) {
  const s = surface(settings);await assert.rejects(openOwnedTaskFileDialog(s.page, title), /^Error: F115_/);assert.equal(s.clicks(), settings.count === 2 ? 0 : 1);
 }
});


test('pageerror diagnostic emits only finite technical classes and a message digest', () => {
 const cases = [
  ['Minified React error #418; visit https://react.dev/errors/418?args[]=private', 'REACT_MINIFIED', 418],
  ['ResizeObserver loop completed with undelivered notifications.', 'RESIZE_OBSERVER_LOOP', null],
  ["Cannot read properties of undefined (reading 'then')", 'UNDEFINED_THEN', null],
  ['An error occurred in the Server Components render. The specific message is omitted in production builds.', 'SERVER_COMPONENT_OPAQUE', null],
  ['Failed to fetch', 'NETWORK_READ_FAILED', null],
  ['private customer secret with https://private.invalid/file', 'OTHER', null],
 ];
 for (const [message, family, reactCode] of cases) {
  const d = plainFileListPageErrorDiagnostic({name: 'TypeError', message, stack: 'at fn (https://staging-crm.peromebel.by/_next/static/chunks/private.js:1:4)'});
  assert.deepEqual(d, {family, errorKind: 'TypeError', reactCode, messageSha256: createHash('sha256').update(message).digest('hex'), sourceClass: 'CRM_STATIC'});assert.equal(JSON.stringify(d).includes('private'), false);
 }
 assert.equal(plainFileListPageErrorDiagnostic({message: cases[2][0], stack: 'at Serwist.register'}).family, 'SERWIST_UNDEFINED_THEN');
 assert.equal(plainFileListPageErrorDiagnostic({name: 'private-unknown', message: 'private', stack: 'at chrome://print/native.js'}).sourceClass, 'NATIVE_PRINT');
 assert.equal(plainFileListPageErrorDiagnostic({name: 'private-unknown'}).errorKind, 'OtherError');
 assert.equal(plainFileListPageErrorDiagnostic(null).family, 'OTHER');
});


test('omitting the proven desktop prefix requires the same current signed scope state and immutable prior digests', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture());
 const prefix = {kind: 'root-verified-desktop-file-prefix', runId: binding.runId, revision: binding.expectedRevision, preSha256: binding.preSha256, currentOwnedStateHash: binding.currentOwnedStateHash, storageManifestHash: binding.storageManifestHash, financialStateHash: binding.financialStateHash, priorReceiptSha256: 'a'.repeat(64), priorObservationSha256: 'b'.repeat(64), checkedDesktopRows: 12};
 assert.equal(fileListsDesktopPrefixAccepted(undefined, binding), false);assert.equal(fileListsDesktopPrefixAccepted(prefix, binding), true);
 for (const changed of [{runId: 'other'}, {revision: '0'.repeat(40)}, {currentOwnedStateHash: '0'.repeat(64)}, {financialStateHash: '0'.repeat(64)}, {storageManifestHash: '0'.repeat(64)}, {preSha256: '0'.repeat(64)}, {priorReceiptSha256: 'invalid'}, {checkedDesktopRows: 0}]) assert.throws(() => fileListsDesktopPrefixAccepted({...prefix, ...changed}, binding), /F115_CURRENT_VERIFIED_DESKTOP_PREFIX_REQUIRED/);
});


test('invalid owned Task can be truthfully deferred only in a wholly read-only unchanged current scope', async () => {
 const binding = await verifyPlainFileListStagingBinding(fixture()), task = {kind:'root-confirmed-unlinked-owned-task',runId:binding.runId,revision:binding.expectedRevision,taskId:binding.ids.task,workId:null,currentOwnedStateHash:binding.currentOwnedStateHash,signedObservationSha256:'a'.repeat(64)};
 assert.equal(fileListsUnlinkedTaskOmitted(undefined,binding,[]),false);assert.equal(fileListsUnlinkedTaskOmitted(task,binding,[]),true);
 for(const change of [{taskId:'foreign'},{revision:'0'.repeat(40)},{workId:'existing'},{currentOwnedStateHash:'0'.repeat(64)},{signedObservationSha256:'bad'}])assert.throws(()=>fileListsUnlinkedTaskOmitted({...task,...change},binding,[]),/F115_CURRENT_UNLINKED_TASK_READONLY_REQUIRED/);
 assert.throws(()=>fileListsUnlinkedTaskOmitted(task,binding,[{mode:'real'}]),/F115_CURRENT_UNLINKED_TASK_READONLY_REQUIRED/);
});
