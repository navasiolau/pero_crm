/** Opt-in QA 115 contract. Import performs no I/O, browser, DB or network operation. */
import {createHash} from 'node:crypto';

export const FILE_LIST_STAGING_ORIGIN = 'https://staging-crm.peromebel.by';
export const FILE_LIST_FIXTURE_NAMESPACE = 'PERO_FILE_ACCEPTANCE_113_V2';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECTIONS = new Set(['GENERAL', 'MEASUREMENT', 'PRODUCTION', 'INSTALLATION']);
const ROLES = {manager: ['MANAGER'], admin: ['ADMIN'], engineer: ['ENGINEER']};
const verifiedBindings = new WeakSet();
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(ok, code) {if (!ok) throw Error(`F115_${code}`);}
export const plainFileListSafeError = error => /^F115_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'F115_CHECK_FAILED';

/** The producer derives the unique export/source/workers inside the guarded container BEFORE HMAC.
 * No full manifest or Next encryption key is required by this consumer. */
export function compiledDeleteFileActionId(descriptor, expectedRevision) {
 check(record(descriptor) && same(Object.keys(descriptor).sort(), ['id', 'exportedName', 'source', 'routes', 'revision', 'rawManifestSha256', 'actionManifestHash'].sort()), 'COMPILED_DELETE_DESCRIPTOR_REQUIRED');
 check(/^[a-f0-9]{42}$/i.test(descriptor.id ?? '') && descriptor.exportedName === 'deleteFile' && descriptor.source === 'src/server/files/actions.ts' && same(descriptor.routes, ['/products/[id]', '/projects/[id]']) && descriptor.revision === expectedRevision && SHA.test(descriptor.rawManifestSha256 ?? '') && SHA.test(descriptor.actionManifestHash ?? ''), 'COMPILED_DELETE_DESCRIPTOR_MISMATCH');
 return descriptor.id;
}

/** Owner 113's reviewed verifier must verify PRE HMAC, physical target and CURRENT owned DB/storage ledger.
 * A boolean, caller-side signature regex or historical prepared receipt is not a verification certificate. */
export async function verifyPlainFileListStagingBinding(input = {}) {
 const {authorized, origin, expectedRevision, identity, handoff: h, profiles, fixtureVerifier} = input;
 check(authorized === true, 'ROOT_AUTH_REQUIRED');
 check(origin === FILE_LIST_STAGING_ORIGIN, 'STAGING_ORIGIN_REQUIRED');
 check(REVISION.test(expectedRevision ?? '') && identity?.hostname === 'crm-staging' && identity.revision === expectedRevision, 'PHYSICAL_REVISION_MISMATCH');
 check(h?.namespace === FILE_LIST_FIXTURE_NAMESPACE && h.kind === 'handoff' && UUID.test(h.runId ?? '') && h.revision === expectedRevision && SHA.test(h.preSha256 ?? '') && SHA.test(h.checkpointHash ?? '') && SHA.test(h.signature ?? '') && ['currentOwnedStateHash', 'storageManifestHash', 'financialStateHash'].every(key => SHA.test(h[key] ?? '')), 'SIGNED_HANDOFF_REQUIRED');
 check(record(fixtureVerifier) && SHA.test(fixtureVerifier.sourceSha256 ?? '') && typeof fixtureVerifier.verifySignedFixture === 'function', 'REVIEWED_OWNER_VERIFIER_REQUIRED');
 const actionId = compiledDeleteFileActionId(h.compiledDeleteFile, expectedRevision), actionManifestHash = h.compiledDeleteFile.actionManifestHash, rawManifestSha256 = h.compiledDeleteFile.rawManifestSha256, compiledDeleteFileHash = producerDigest(h.compiledDeleteFile);
 check(h.actionManifestHash === actionManifestHash && h.rawManifestSha256 === rawManifestSha256, 'SIGNED_MANIFEST_PROVENANCE_MISMATCH');
 let certificate;
 try {certificate = await fixtureVerifier.verifySignedFixture({handoff: h, identity, expectedRevision, actionManifestHash, rawManifestSha256, compiledDeleteFileHash});} catch {throw Error('F115_OWNER_VERIFICATION_REJECTED');}
 check(record(certificate) && certificate.kind === 'current-owned-fixture-verification' && certificate.namespace === FILE_LIST_FIXTURE_NAMESPACE && certificate.verifierSourceSha256 === fixtureVerifier.sourceSha256 && certificate.runId === h.runId && certificate.revision === expectedRevision && certificate.preSha256 === h.preSha256 && certificate.checkpointHash === h.checkpointHash && certificate.actionManifestHash === actionManifestHash && certificate.rawManifestSha256 === rawManifestSha256 && certificate.compiledDeleteFileHash === compiledDeleteFileHash && ['currentOwnedStateHash', 'storageManifestHash', 'financialStateHash'].every(key => SHA.test(certificate[key] ?? '') && certificate[key] === h[key]), 'CURRENT_OWNER_VERIFICATION_REQUIRED');
 check(record(h.ids) && ['project', 'product', 'task'].every(key => ID.test(h.ids[key] ?? '')) && /^[A-Za-z0-9_.-]{1,128}$/.test(h.productNumber ?? ''), 'OWNED_SUBJECTS_REQUIRED');
 check(typeof h.taskTitle === 'string' && h.taskTitle.includes(h.runId), 'SYNTHETIC_TASK_LABEL_REQUIRED');
 const paths = {project: `/projects/${encodeURIComponent(h.ids.project)}`, product: `/products/${encodeURIComponent(h.productNumber)}`, financeProject: `/finance/projects/${encodeURIComponent(h.ids.project)}`};
 check(h.paths?.project === paths.project && h.paths?.product === paths.product && (h.paths.financeProject === undefined || h.paths.financeProject === paths.financeProject), 'OWNED_PATHS_MISMATCH');
 const actorIds = new Set(), cookieValues = new Set(), privateProfiles = {};
 for (const [name, roles] of Object.entries(ROLES)) {
  const actor = h.actors?.[name], profile = profiles?.[name];
  check(ID.test(actor?.id ?? '') && !actorIds.has(actor.id) && same(actor.roles, roles) && Number.isSafeInteger(actor.sessionVersion) && actor.sessionVersion >= 0 && profile?.id === actor.id && same(profile.roles, roles), 'OWN_CURRENT_ACTOR_MISMATCH');
  actorIds.add(actor.id);
  check(Array.isArray(profile.cookies) && profile.cookies.length > 0 && profile.cookies.length <= 2, 'PRIVATE_COOKIES_REQUIRED');
  const names = new Set();
  const cookies = profile.cookies.map(cookie => {
   check(['__Secure-authjs.session-token', 'authjs.session-token'].includes(cookie?.name) && !names.has(cookie.name) && typeof cookie.value === 'string' && cookie.value.length > 0 && cookie.value.length < 8192 && !cookieValues.has(cookie.value), 'SESSION_COOKIE_INVALID');
   check((cookie.url === undefined || cookie.url === origin) && (cookie.domain === undefined || cookie.domain === 'staging-crm.peromebel.by') && (cookie.path === undefined || cookie.path === '/') && (cookie.secure === undefined || cookie.secure === true) && (cookie.httpOnly === undefined || cookie.httpOnly === true), 'COOKIE_SCOPE_MISMATCH');
   names.add(cookie.name);cookieValues.add(cookie.value);
   return {name: cookie.name, value: cookie.value, url: origin, secure: true, httpOnly: true, sameSite: 'Lax'};
  });
  privateProfiles[name] = {id: actor.id, roles: [...roles], cookies};
 }
 const allIds = new Set(), files = [];
 check(Array.isArray(h.files) && h.files.length >= 4, 'OWNED_FILES_REQUIRED');
 for (const file of h.files) {
  check(ID.test(file?.id ?? '') && !allIds.has(file.id) && typeof file.fileName === 'string' && file.fileName.includes(h.runId) && /\.[A-Za-z0-9]{1,12}$/.test(file.fileName) && typeof file.mimeType === 'string' && file.mimeType.length <= 128 && SECTIONS.has(file.section) && actorIds.has(file.uploadedById) && file.projectId === h.ids.project && [null, h.ids.product].includes(file.productId) && [null, h.ids.task].includes(file.taskId) && SHA.test(file.contentHash ?? '') && SHA.test(file.versionSetHash ?? ''), 'FILE_OWNERSHIP_OR_VERSION_MISMATCH');
  allIds.add(file.id);
  files.push({id: file.id, fileName: file.fileName, mimeType: file.mimeType, section: file.section, uploadedById: file.uploadedById, productId: file.productId, taskId: file.taskId, contentHash: file.contentHash, versionSetHash: file.versionSetHash, isCurrentSketch: file.id === h.currentSketchFileId, isCurrentProjectCover: file.id === h.currentProjectCoverFileId});
 }
 check(files.some(file => file.isCurrentSketch && file.mimeType.startsWith('image/')), 'OWN_SKETCH_REQUIRED');
 const financeDocs = [];
 check(Array.isArray(h.financeDocs), 'OWNED_FINANCE_DOCS_REQUIRED');
 const finance = h.finance === undefined ? null : h.finance;
 if (finance) {
  check(['accountId', 'articleId', 'incomeId', 'expenseId'].every(key => ID.test(finance[key] ?? '')) && typeof finance.accountName === 'string' && finance.accountName.includes(h.runId) && typeof finance.incomeComment === 'string' && finance.incomeComment.includes(h.runId) && typeof finance.expenseComment === 'string' && finance.expenseComment.includes(h.runId) && /^\d{4}-\d{2}-\d{2}$/.test(finance.date ?? '') && finance.currency === 'BYN' && finance.incomeAmount === '2' && finance.expenseAmount === '1' && finance.rate === '1', 'OWN_FINANCE_SCOPE_MISMATCH');
 }
 for (const doc of h.financeDocs) {
  check(ID.test(doc?.id ?? '') && !allIds.has(doc.id) && doc.uploadedById === h.actors.admin.id && doc.status === 'READY' && typeof doc.fileName === 'string' && doc.fileName.includes(h.runId) && /\.[A-Za-z0-9]{1,12}$/.test(doc.fileName) && typeof doc.mimeType === 'string' && SHA.test(doc.contentHash ?? '') && SHA.test(doc.versionSetHash ?? '') && (doc.paymentId === null || (finance && [finance.incomeId, finance.expenseId].includes(doc.paymentId))), 'FINANCE_DOC_OWNERSHIP_MISMATCH');
  allIds.add(doc.id);financeDocs.push({id: doc.id, fileName: doc.fileName, mimeType: doc.mimeType, paymentId: doc.paymentId, contentHash: doc.contentHash, versionSetHash: doc.versionSetHash});
 }
 check(h.currentProjectCoverFileId === null || h.currentProjectCoverFileId === undefined || files.some(file => file.isCurrentProjectCover), 'OWN_PROJECT_COVER_REQUIRED');
 const binding = {origin, expectedRevision, runId: h.runId, ids: {...h.ids}, taskTitle: h.taskTitle, paths, profiles: privateProfiles, files, financeDocs, finance: finance ? {...finance} : null, actionId, verifierSourceSha256: certificate.verifierSourceSha256, currentOwnedStateHash: certificate.currentOwnedStateHash, storageManifestHash: certificate.storageManifestHash, financialStateHash: certificate.financialStateHash, preSha256: h.preSha256, checkpointHash: h.checkpointHash};
 verifiedBindings.add(binding);return binding;
}

/** Public Next assets include route groups and dynamic route segment names. */
export function isPlainFileListStaticReadPath(pathname) {
 if (typeof pathname !== 'string' || pathname.includes('\\') || /%(?:2f|5c)/i.test(pathname)) return false;
 let decoded;try {decoded = decodeURIComponent(pathname);} catch {return false;}
 return /^\/(?:_next\/static|icons)\/[-A-Za-z0-9_./@()\[\]]+$/.test(decoded) && !decoded.includes('..');
}

/** GET/HEAD only, plus a separately armed single compiled deleteFile action. No URLs/bodies in decisions. */
export function plainFileListRequestDecision(request, binding) {
 let url;try {url = new URL(request.url);} catch {return {kind: 'deny', code: 'F115_INVALID_URL'};}
 if (url.origin !== binding.origin || url.username || url.password || url.hash) return {kind: 'deny', code: 'F115_CROSS_ORIGIN_REQUEST'};
 const own = [binding.paths.project, binding.paths.product, binding.paths.financeProject].includes(url.pathname);
 const financePages = binding.finance && ['/finance/expenses', '/finance/income', '/finance/accounts/report'].includes(url.pathname);
 const only = allowed => new Set([...url.searchParams.keys()]).size === [...url.searchParams].length && [...url.searchParams].every(([key, value]) => allowed(key, value));
 const ownedQuery = url.pathname === binding.paths.project ? only((key, value) => key === '_rsc' || (key === 'tab' && ['files', 'tasks', 'finance'].includes(value))) : only(key => key === '_rsc');
 if (!['GET', 'HEAD'].includes(request.method)) {
  if (request.method === 'POST' && own && ownedQuery && request.actionId === binding.actionId) return {kind: 'candidate-delete'};
  return {kind: 'abort-write', code: 'F115_UNARMED_WRITE_BLOCKED'};
 }
 if (request.prefetch) return {kind: 'abort-prefetch', code: 'F115_PREFETCH_BLOCKED'};
 if (own && ownedQuery) return {kind: 'continue'};
 if (financePages && (url.pathname !== '/finance/accounts/report' ? only(key => key === '_rsc') : only((key, value) => key === '_rsc' || (['from', 'to'].includes(key) && value === binding.finance.date) || (key === 'mode' && value === 'BYN')))) return {kind: 'continue'};
 if (['/api/health', '/api/auth/session'].includes(url.pathname) && !url.search) return {kind: 'continue'};
 if ((['/favicon.ico', '/icon.svg', '/apple-icon.png', '/manifest.webmanifest'].includes(url.pathname) && !url.search) || isPlainFileListStaticReadPath(url.pathname)) return {kind: 'continue'};
 const ordinary = binding.files.find(file => url.pathname === `/api/files/${file.id}`), financial = binding.financeDocs.find(file => url.pathname === `/api/finance/documents/${file.id}`);
 if ((ordinary && only((key, value) => key === 'preview' && ['card', 'cover', 'thumbnail'].includes(value))) || (financial && !url.search)) return {kind: 'continue'};
 return {kind: 'deny', code: 'F115_GET_ROUTE_FORBIDDEN'};
}

/** Parse only the one compact action result. Never return raw Flight records/error text. */
export function plainFileDeleteFlightOutcome(bytes) {
 check(Buffer.byteLength(bytes) <= 4 * 1024 * 1024, 'FLIGHT_RESPONSE_TOO_LARGE');
 const values = [];
 for (const line of Buffer.from(bytes).toString('utf8').split('\n')) {
  const colon = line.indexOf(':');if (colon < 1) continue;
  try {const value = JSON.parse(line.slice(colon + 1));if (record(value) && typeof value.ok === 'boolean') values.push(value);} catch { /* Other Flight records are opaque. */ }
 }
 check(values.length === 1 && Object.keys(values[0]).every(key => ['ok', 'error'].includes(key)) && (values[0].error === undefined || typeof values[0].error === 'string'), 'FLIGHT_RESULT_MISSING_OR_AMBIGUOUS');
 return {ok: values[0].ok};
}

/** The owner ledger is persisted before an upstream request and observed even after a lost ACK.
 * A consumed permit is never retried. Storage deletion is best effort in the existing app action. */
export function createPlainFileListDeleteGate(binding, callbacks = {}) {
 check(verifiedBindings.has(binding), 'VERIFIED_BINDING_REQUIRED');
 check(['persistPreIntent', 'observeOwnedState', 'persistAcknowledgement'].every(key => typeof callbacks[key] === 'function'), 'OWNER_LEDGER_CALLBACKS_REQUIRED');
 let permit = null, stopped = false, inFlight = false, sequence = 0, stateHash = binding.currentOwnedStateHash;
 const executed = new Set();
 const consumed = new Set(), issuedIntents = new WeakSet();
 function arm({fileId, actor, path, mode = 'real'}) {
  check(!stopped && !permit && !inFlight && !consumed.has(fileId), 'PERMIT_NOT_AVAILABLE');
  const file = binding.files.find(item => item.id === fileId), profile = binding.profiles[actor];
  check(file && profile && ['manager', 'admin', 'engineer'].includes(actor) && ['real', 'client-error'].includes(mode) && !file.isCurrentSketch && !file.isCurrentProjectCover && [binding.paths.project, binding.paths.product].includes(path), 'OWN_DELETE_SCOPE_REQUIRED');
  check(actor !== 'engineer' || file.uploadedById === profile.id, 'OWN_DELETE_ACTOR_REQUIRED');
  permit = {fileId, actor, actorId: profile.id, path, mode};
 }
 function consume(request, actor) {
  const decision = plainFileListRequestDecision(request, binding);check(decision.kind === 'candidate-delete' && permit && !stopped, 'DELETE_NOT_ARMED');
  const url = new URL(request.url);let args;try {args = JSON.parse(request.body ?? '');} catch {throw Error('F115_DELETE_ARGS_INVALID');}
  check(actor === permit.actor && url.pathname === permit.path && Array.isArray(args) && args.length === 1 && args[0] === permit.fileId, 'DELETE_ARGS_OR_ACTOR_MISMATCH');
  const intent = {...permit, sequence: ++sequence};permit = null;consumed.add(intent.fileId);
  const file = binding.files.find(item => item.id === intent.fileId);
  const bound = Object.freeze({...intent, runId: binding.runId, revision: binding.expectedRevision, preSha256: binding.preSha256, checkpointHash: binding.checkpointHash, expectedStateHash: stateHash, contentHash: file.contentHash, versionSetHash: file.versionSetHash});
  issuedIntents.add(bound);return bound;
 }
 async function execute(intent, send) {
  check(issuedIntents.has(intent) && !stopped && !inFlight && !executed.has(intent.sequence) && consumed.has(intent.fileId) && intent.expectedStateHash === stateHash, 'DELETE_STATE_CHANGED');
  executed.add(intent.sequence);
  if (intent.mode === 'client-error') return {kind: 'abort-client-error'};
  inFlight = true;
  let sent = false, result = null, transportComplete = false;
  try {
   const prepared = await callbacks.persistPreIntent(intent);
   check(prepared?.recorded === true && prepared.expectedStateHash === stateHash && prepared.sequence === intent.sequence, 'PREINTENT_NOT_DURABLE');
   check(!stopped, 'STOP_BEFORE_UPSTREAM');
   sent = true;const response = await send();transportComplete = true;
   check(response.status === 200 && !response.redirected && response.contentType?.startsWith('text/x-component'), 'ACTION_RESPONSE_METADATA_INVALID');
   result = plainFileDeleteFlightOutcome(response.body);
   const observation = await callbacks.observeOwnedState({...intent, outcome: result.ok ? 'acknowledged-delete' : 'acknowledged-refusal'});
   check(observation?.verified === true && observation.previousStateHash === stateHash && SHA.test(observation.stateHash ?? '') && observation.filePresent === !result.ok && observation.storageVersionsAccounted === true && observation.financialStateHash === binding.financialStateHash && observation.tokenClockValid === true, 'OWNER_CAS_OBSERVATION_FAILED');
   stateHash = observation.stateHash;
   const acknowledgement = await callbacks.persistAcknowledgement({...intent, outcome: result.ok ? 'deleted' : 'refused', stateHash});
   check(acknowledgement?.recorded === true && acknowledgement.sequence === intent.sequence && acknowledgement.stateHash === stateHash, 'ACKNOWLEDGEMENT_NOT_DURABLE');
   return {kind: 'acknowledged', ok: result.ok};
  } catch (error) {
   stopped = true;
   if (sent) {
    try {await callbacks.observeOwnedState({...intent, outcome: 'unknown', transportComplete, acknowledgementReceived: result !== null});} catch { /* STOP: root reconciles the persisted pre-intent, never retries. */ }
   }
   throw Error(plainFileListSafeError(error));
  } finally {inFlight = false;}
 }
 return {arm, consume, execute, currentStateHash() {return stateHash;}, assertUnarmed() {check(!permit && !stopped && !inFlight, 'DELETE_GATE_STOPPED_OR_ARMED');}, stop() {stopped = true;permit = null;}};
}
/** The producer defines signed metadata with canonical sorted object keys, independently of
 * the parsed Next manifest hash. No signer/key or post-sign metadata mutation is needed here. */
function producerDigest(value) {
 const canonical = item => Array.isArray(item) ? `[${item.map(canonical).join(',')}]` : record(item) ? `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}` : JSON.stringify(item);
 return createHash('sha256').update(canonical(value)).digest('hex');
}

/** Source-backed bridge only. Actual coordinator113 publishes its signed intent and ACK with
 * fsync before these methods resolve. This adapter never prepares/uploads/links/deletes data. */
export function createPlainFileListOwnerLedger(binding, coordinator) {
 check(verifiedBindings.has(binding) && ['preDelete', 'afterDelete', 'observe', 'verifyFinalState', 'state'].every(key => typeof coordinator?.[key] === 'function'), 'REVIEWED_COORDINATOR_REQUIRED');
 check(coordinator.state().sourceHashes?.['file-fixture113-entry.mjs'] === binding.verifierSourceSha256, 'COORDINATOR_SOURCE_MISMATCH');
 let outstanding = null, stopped = false, sequence = 0, ownedHash = binding.currentOwnedStateHash, storageHash = binding.storageManifestHash;
 function envelope(value, kind) {
  check(record(value) && value.namespace === FILE_LIST_FIXTURE_NAMESPACE && value.kind === kind && value.runId === binding.runId && value.revision === binding.expectedRevision && value.preSha256 === binding.preSha256 && SHA.test(value.signature ?? ''), 'PRODUCER_SIGNED_ENVELOPE_MISMATCH');
 }
 function observation(value) {
  envelope(value, 'observation');
  check(record(value.rows) && Array.isArray(value.rows.File) && Array.isArray(value.storage) && value.currentOwnedStateHash === producerDigest(value.rows) && value.storageManifestHash === producerDigest(value.storage) && value.financialStateHash === binding.financialStateHash && value.originalVerification?.originalRelationsMatch === true && value.originalVerification.preferencesUntouched === true && value.originalVerification.tokenClockValid === true, 'PRODUCER_CURRENT_OBSERVATION_MISMATCH');
 }
 function sameIntent(intent) {
  check(outstanding && intent.sequence === outstanding.ui.sequence && intent.fileId === outstanding.ui.fileId && intent.actorId === outstanding.ui.actorId && intent.runId === binding.runId && intent.revision === binding.expectedRevision && intent.preSha256 === binding.preSha256 && intent.checkpointHash === binding.checkpointHash && intent.expectedStateHash === outstanding.ui.expectedStateHash && intent.contentHash === outstanding.ui.contentHash && intent.versionSetHash === outstanding.ui.versionSetHash, 'OUTSTANDING_UI_INTENT_MISMATCH');
 }
 return {
  async persistPreIntent(intent) {
   check(!stopped && !outstanding && Number.isSafeInteger(intent.sequence) && intent.sequence > sequence && intent.expectedStateHash === ownedHash && intent.runId === binding.runId && intent.revision === binding.expectedRevision && intent.preSha256 === binding.preSha256 && intent.checkpointHash === binding.checkpointHash && binding.profiles[intent.actor]?.id === intent.actorId, 'PRODUCER_PREINTENT_SCOPE_MISMATCH');
   const file = binding.files.find(row => row.id === intent.fileId);
   check(file && file.contentHash === intent.contentHash && file.versionSetHash === intent.versionSetHash, 'UI_FILE_BINDING_CHANGED');
   // Reserve synchronously, before the durable publisher crosses an await boundary.
   outstanding = {ui: intent, signedIntent: null, ack: null};sequence = intent.sequence;
   try {
    const signedIntent = await coordinator.preDelete({fileId: intent.fileId, actorKey: intent.actor});envelope(signedIntent, 'delete-intent');observation(signedIntent.observation);
    check(signedIntent.fileId === intent.fileId && signedIntent.actorId === intent.actorId && signedIntent.expectedOwnStateHash === ownedHash && signedIntent.observation.currentOwnedStateHash === ownedHash && signedIntent.expectedStorageManifestHash === storageHash && signedIntent.observation.storageManifestHash === storageHash, 'PRODUCER_PREINTENT_CAS_MISMATCH');
    const current = signedIntent.observation.rows.File.find(row => row.id === file.id);
    check(current && current.projectId === binding.ids.project && current.fileName === file.fileName && current.mimeType === file.mimeType && current.section === file.section && current.uploadedById === file.uploadedById && (current.productId ?? null) === file.productId && (current.taskId ?? null) === file.taskId && typeof current.storedName === 'string' && typeof current.hasThumb === 'boolean', 'PRODUCER_OWN_FILE_METADATA_CHANGED');
    const keys = [current.projectId + '/' + current.storedName, ...(current.hasThumb ? [current.projectId + '/thumbs/' + current.storedName + '.jpg'] : [])];
    check(producerDigest(signedIntent.observation.storage.filter(row => keys.includes(row.key))) === intent.versionSetHash, 'PRODUCER_FILE_VERSION_SET_CHANGED');
    check(!stopped, 'COORDINATOR_STOPPED');outstanding.signedIntent = signedIntent;
    return {recorded: true, expectedStateHash: ownedHash, sequence};
   } catch (error) {stopped = true;throw Error(plainFileListSafeError(error));}
  },
  async observeOwnedState(intent) {
   sameIntent(intent);
   if (intent.outcome === 'unknown') {
    stopped = true;
    // Only a late signed observation is captured. No deleted/cancelled inference or ACK follows.
    const current = await coordinator.observe();observation(current);
    return {unknown: true};
   }
   check(!stopped && outstanding.signedIntent && !outstanding.ack && ['acknowledged-delete', 'acknowledged-refusal'].includes(intent.outcome), 'PRODUCER_ACK_SCOPE_MISMATCH');
   try {
    const refused = intent.outcome === 'acknowledged-refusal', ack = await coordinator.afterDelete(outstanding.signedIntent, {cancelled: refused});envelope(ack, 'delete-ack');observation(ack.observation);
    const proof = ack.verification;
    check(ack.intentSha256 === producerDigest(outstanding.signedIntent) && proof?.versionsAccounted === true && proof.priorOwnAuditPreserved === true && proof.ownPreferencesUntouched === true && (refused ? proof.cancelled === true : proof.deleted === true && ID.test(proof.auditId ?? '')), 'PRODUCER_EXACT_DELETE_PROOF_REQUIRED');
    const present = ack.observation.rows.File.some(row => row.id === intent.fileId);check(present === refused, 'PRODUCER_FILE_PRESENCE_MISMATCH');
    const previousStateHash = ownedHash;ownedHash = ack.observation.currentOwnedStateHash;storageHash = ack.observation.storageManifestHash;outstanding.ack = ack;
    return {verified: true, previousStateHash, stateHash: ownedHash, filePresent: present, storageVersionsAccounted: true, financialStateHash: ack.observation.financialStateHash, tokenClockValid: ack.observation.originalVerification.tokenClockValid};
   } catch (error) {stopped = true;throw Error(plainFileListSafeError(error));}
  },
  async persistAcknowledgement(intent) {
   sameIntent(intent);check(!stopped && outstanding.ack && intent.stateHash === ownedHash && (intent.outcome === 'deleted' ? outstanding.ack.verification.deleted === true : intent.outcome === 'refused' && outstanding.ack.verification.cancelled === true), 'PRODUCER_DURABLE_ACK_REQUIRED');
   // afterDelete already durably published this exact signed ACK; never manufacture an ACK.
   const result = {recorded: true, sequence: intent.sequence, stateHash: ownedHash};outstanding = null;return result;
  },
  async verifyFinalState(input) {
   check(!stopped && !outstanding && input.runId === binding.runId && input.revision === binding.expectedRevision && input.preSha256 === binding.preSha256 && input.checkpointHash === binding.checkpointHash && input.expectedOwnedStateHash === ownedHash, 'PRODUCER_FINAL_CAS_REQUIRED');
   const final = await coordinator.verifyFinalState();envelope(final, 'current-owned-final-verification');
   check(final.checkpointHash === binding.checkpointHash && final.verifierSourceSha256 === binding.verifierSourceSha256 && final.currentOwnedStateHash === ownedHash && final.storageManifestHash === storageHash && final.financialStateHash === binding.financialStateHash && final.untouchedRelationsMatch === true && final.preferencesUntouched === true && final.storageVersionsAccounted === true && final.tokenClockValid === true, 'PRODUCER_FINAL_PROOF_MISMATCH');
   return final;
  },
 };
}