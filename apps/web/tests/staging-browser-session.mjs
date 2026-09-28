/**
 * PRIVATE root-owned browser QA transport. Never run against production.
 * Root must independently verify crm-staging hostname, Docker/DB identity, mounts
 * and exact deployed image revision before every operation.
 *
 * Input (base64 UTF-8 JSON, <=96 KiB ENCODED) in CRM_STAGING_BROWSER_INPUT:
 *   { operation: "prepare" }
 *   { operation: "restore", checkpoint, ownWrites: [{ userId, key, value }] }
 *   { operation: "inspect", checkpoint, ownWrites: [{ userId, key, value }] }
 * stdin is reserved for this locally bundled module (node --input-type=module).
 * Bundle locally with esbuild: platform=node, format=esm, external @prisma/client.
 *
 * prepare stdout IS SECRET: capture only in the root-local process/private file,
 * never print to tools/chat/logs. It returns {status:"PREPARED", checkpoint,
 * profiles, paths, expected, originalPreferences, availability, sessionExpiresAt}.
 * Browser profiles are keyed manager/engineer plus combined ONLY when it exists:
 * {id,roles,cookies:[{name,value}],canVisitMy}. availability.combined=false means
 * the missing role scenario MUST be reported NOT_AVAILABLE, never synthesized.
 * JWTs last 15 minutes; AUTH_SECRET never leaves this process.
 * Paths: paths.project, paths.product, paths.engineerProduct.
 * Expected: engineerProductNumber, engineerProductCount, engineerProducts (full
 * permitted set: id/number/status/engineerId), and existing title lengths.
 * Original preferences contain EXACTLY projects.list/products.list for those
 * two or three users (4 or 6 keys). Baseline includes 13 business tables and
 * ChangeLog/TimeEntry. The signed checkpoint contains only run metadata,
 * availability, profile ids/roles, original prefs and baseline; NO JWT cookies.
 * Keep the ENTIRE checkpoint immutable: an HMAC authenticates every field.
 * Clone cookie objects before adding URL/domain/path in the browser context.
 *
 * ownWrites contains only the LAST successful saveListPreference response.value
 * for each userId/key, captured AFTER response.ok === true. Never pass intended
 * query strings, guessed revisions, conflicted response values, or extra keys.
 * Stop browser requests and pending preference saves before restore. Do not visit
 * /my unless canVisitMy=true (snapshot only; that route can auto-stop old timers).
 * Restore works after cookies expire and must use the ORIGINAL checkpoint.
 *
 * Restore: current===original => noop; current===lastOwnWrite => CAS restore;
 * anything else => whole transaction rollback. Null originals are restored by
 * deleting only the exact owned value; no inserts/upserts are ever performed.
 * No business CRUD, fixtures, passwords/roles/sessionVersion, schema or seed.
 * Safe restore/error output contains only statuses, counts and hashes.
 * inspect is READ ONLY and returns PRIVATE preference diagnostics (ids, revisions,
 * decoded queries and current legacy .view fallback), never cookies/AUTH_SECRET.
 * Semantic query equality does NOT prove ownership and never authorizes restore.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";

const NAMESPACE = "PERO_STAGING_BROWSER_CHECKPOINT_V1";
const MAX_INPUT = 96 * 1024;
const PREF_KEYS = ["projects.list", "products.list"];
const PROFILE_KEYS = ["manager", "combined", "engineer"];
const BUSINESS_TABLES = ["User", "Client", "Project", "Product", "Task", "Work", "File", "Payment", "Payout", "PayrollEntry", "Material", "ProjectMaterial", "StockMovement"];
const AUDIT_TIME_TABLES = ["ChangeLog", "TimeEntry"];

class SafeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireThat(condition, code) { if (!condition) throw new SafeFailure(code); }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, keys) {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function sameRoles(left, right) {
  return Array.isArray(left) && Array.isArray(right) && [...left].sort().join("|") === [...right].sort().join("|");
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function checkpointSignature(checkpoint, secret) {
  const payload = { ...checkpoint };
  delete payload.signature;
  return createHmac("sha256", secret).update(`${NAMESPACE}\0`).update(canonical(payload)).digest("hex");
}
function preferenceId(row) { return JSON.stringify([row.userId, row.key]); }

function readEnvelope() {
  const encoded = process.env.CRM_STAGING_BROWSER_INPUT;
  delete process.env.CRM_STAGING_BROWSER_INPUT;
  requireThat(typeof encoded === "string" && encoded.length > 0 && Buffer.byteLength(encoded, "ascii") <= MAX_INPUT, "PRIVATE_INPUT_REQUIRED_OR_TOO_LARGE");
  requireThat(encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded), "PRIVATE_INPUT_BASE64_INVALID");
  const bytes = Buffer.from(encoded, "base64");
  requireThat(bytes.toString("base64") === encoded, "PRIVATE_INPUT_BASE64_NONCANONICAL");
  let input;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new SafeFailure("PRIVATE_INPUT_JSON_INVALID"); }
  requireThat(["prepare", "restore", "inspect"].includes(input?.operation), "OPERATION_REQUIRED");
  requireThat(exactKeys(input, input.operation === "prepare" ? ["operation"] : ["operation", "checkpoint", "ownWrites"]), "INPUT_FIELDS_INVALID");
  return input;
}

function environmentGuard() {
  requireThat(process.env.S3_BUCKET === "pero-crm-staging", "STAGING_BUCKET_REQUIRED");
  let url;
  try { url = new URL(process.env.DATABASE_URL ?? ""); } catch { throw new SafeFailure("DATABASE_URL_INVALID"); }
  requireThat(["postgres:", "postgresql:"].includes(url.protocol), "POSTGRES_REQUIRED");
  requireThat(url.hostname === "db" && decodeURIComponent(url.pathname) === "/crm", "STAGING_DATABASE_REQUIRED");
  requireThat((!url.port || url.port === "5432") && !url.hash, "DATABASE_ADDRESS_NOT_ALLOWLISTED");
  const options = new Set(["schema", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "sslmode"]);
  requireThat([...url.searchParams.keys()].every((key) => options.has(key)), "DATABASE_OPTIONS_NOT_ALLOWLISTED");
  requireThat([...url.searchParams.keys()].every((key) => url.searchParams.getAll(key).length === 1), "DUPLICATE_DATABASE_OPTION");
  requireThat(!url.searchParams.has("schema") || url.searchParams.get("schema") === "public", "PUBLIC_SCHEMA_REQUIRED");
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  requireThat(typeof secret === "string" && secret.length > 0, "AUTH_SECRET_REQUIRED");
  return secret;
}

async function databaseGuard(tx, readonly) {
  environmentGuard();
  const [identity] = await tx.$queryRawUnsafe("SELECT current_database() AS name, current_schema() AS schema, current_setting('transaction_read_only') AS readonly");
  requireThat(identity?.name === "crm" && identity.schema === "public", "DATABASE_IDENTITY_MISMATCH");
  requireThat(identity.readonly === (readonly ? "on" : "off"), "TRANSACTION_MODE_MISMATCH");
}

async function snapshot(tx, tables) {
  const result = {};
  for (const table of tables) {
    // Table identifiers are hard-coded allowlists; no checkpoint text enters SQL.
    const [row] = await tx.$queryRawUnsafe(`SELECT count(*)::integer AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id), '')) AS hash FROM "${table}" t`);
    result[table] = row;
  }
  return result;
}
async function snapshots(tx) {
  return { business: await snapshot(tx, BUSINESS_TABLES), auditAndTime: await snapshot(tx, AUDIT_TIME_TABLES) };
}

function validateCheckpoint(checkpoint, secret) {
  requireThat(record(checkpoint) && checkpoint.version === 1 && checkpoint.namespace === NAMESPACE, "CHECKPOINT_FORMAT_INVALID");
  requireThat(typeof checkpoint.signature === "string" && /^[a-f0-9]{64}$/.test(checkpoint.signature), "CHECKPOINT_SIGNATURE_REQUIRED");
  requireThat(timingSafeEqual(Buffer.from(checkpoint.signature, "hex"), Buffer.from(checkpointSignature(checkpoint, secret), "hex")), "CHECKPOINT_SIGNATURE_MISMATCH");
  requireThat(exactKeys(checkpoint.availability, ["combined"]) && typeof checkpoint.availability.combined === "boolean", "CHECKPOINT_AVAILABILITY_INVALID");
  const profileKeys = PROFILE_KEYS.filter((key) => key !== "combined" || checkpoint.availability.combined);
  requireThat(exactKeys(checkpoint.profiles, profileKeys), "CHECKPOINT_PROFILES_INVALID");
  const ids = [];
  const expectedRoles = { manager: ["MANAGER"], combined: ["MANAGER", "ENGINEER"], engineer: ["ENGINEER"] };
  for (const key of profileKeys) {
    const profile = checkpoint.profiles[key];
    requireThat(exactKeys(profile, ["id", "roles"]) && typeof profile.id === "string" && profile.id.length > 0 && profile.id.length <= 128, "CHECKPOINT_PROFILE_ID_INVALID");
    requireThat(sameRoles(profile.roles, expectedRoles[key]), "CHECKPOINT_PROFILE_IDENTITY_INVALID");
    ids.push(profile.id);
  }
  requireThat(new Set(ids).size === profileKeys.length, "DISTINCT_PROFILE_USERS_REQUIRED");
  const originals = checkpoint.originalPreferences;
  requireThat(Array.isArray(originals) && originals.length === profileKeys.length * 2, "EXACT_ORIGINAL_PREFERENCE_SET_REQUIRED");
  const seen = new Set();
  for (const row of originals) {
    requireThat(exactKeys(row, ["userId", "key", "value"]) && ids.includes(row.userId) && PREF_KEYS.includes(row.key), "ORIGINAL_PREFERENCE_NOT_ALLOWLISTED");
    requireThat(row.value === null || (typeof row.value === "string" && row.value.length <= 8192), "ORIGINAL_PREFERENCE_VALUE_INVALID");
    requireThat(!seen.has(preferenceId(row)), "DUPLICATE_ORIGINAL_PREFERENCE");
    seen.add(preferenceId(row));
  }
  requireThat(exactKeys(checkpoint.baseline, ["business", "auditAndTime"]), "CHECKPOINT_BASELINE_INVALID");
  for (const [kind, tables] of [["business", BUSINESS_TABLES], ["auditAndTime", AUDIT_TIME_TABLES]]) {
    requireThat(exactKeys(checkpoint.baseline[kind], tables), "BASELINE_TABLES_INVALID");
    for (const table of tables) {
      const row = checkpoint.baseline[kind][table];
      requireThat(exactKeys(row, ["count", "hash"]) && Number.isSafeInteger(row.count) && row.count >= 0 && typeof row.hash === "string" && /^[a-f0-9]{32}$/.test(row.hash), "BASELINE_HASH_INVALID");
    }
  }
  return originals;
}

function validateOwnWrites(originals, ownWrites) {
  requireThat(Array.isArray(ownWrites) && ownWrites.length <= originals.length, "OWN_WRITES_INVALID");
  const allowed = new Set(originals.map(preferenceId));
  const writes = new Map();
  for (const row of ownWrites) {
    requireThat(exactKeys(row, ["userId", "key", "value"]) && allowed.has(preferenceId(row)), "OWN_WRITE_NOT_ALLOWLISTED");
    requireThat(typeof row.value === "string" && row.value.length > 0 && row.value.length <= 8192, "OWN_WRITE_VALUE_INVALID");
    let parsed;
    try { parsed = JSON.parse(row.value); } catch { throw new SafeFailure("OWN_WRITE_RESPONSE_VALUE_REQUIRED"); }
    requireThat(parsed?.version === 1 && typeof parsed.revision === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.revision) && typeof parsed.query === "string", "OWN_WRITE_RESPONSE_VALUE_REQUIRED");
    requireThat(new URLSearchParams(parsed.query).toString() === parsed.query && /^[\x20-\x7e]*$/.test(parsed.query), "OWN_WRITE_CANONICAL_QUERY_REQUIRED");
    requireThat(row.value === JSON.stringify({ version: 1, revision: parsed.revision, query: parsed.query }), "EXACT_SUCCESS_RESPONSE_BYTES_REQUIRED");
    requireThat(!writes.has(preferenceId(row)), "DUPLICATE_OWN_WRITE");
    writes.set(preferenceId(row), row.value);
  }
  return writes;
}

function buildRestorePlan(originals, writes, rows) {
  const current = new Map(rows.map((row) => [preferenceId(row), row.value]));
  // Compute EVERY conflict before performing the first update/delete.
  return originals.map((original) => {
    const key = preferenceId(original);
    const value = current.get(key) ?? null;
    if (value === original.value) return { ...original, action: "noop" };
    requireThat(writes.has(key) && value === writes.get(key), "PREFERENCE_CONFLICT");
    return { ...original, expectedOwnValue: value, action: original.value === null ? "delete" : "update" };
  });
}

function describePreference(value) {
  if (value === null) return { status: "MISSING", bytes: 0, sha256: null, revision: null, query: null, decodedQuery: null };
  const summary = { status: "INVALID_JSON", bytes: Buffer.byteLength(value, "utf8"), sha256: createHash("sha256").update(value).digest("hex"), revision: null, query: null, decodedQuery: null };
  if (value.length > 8192) return { ...summary, status: "OVERSIZED_NOT_DECODED" };
  let parsed;
  try { parsed = JSON.parse(value); } catch { return summary; }
  if (!record(parsed) || parsed.version !== 1 || typeof parsed.query !== "string") return { ...summary, status: "INVALID_V1_SHAPE" };
  // Diagnostic decoding only. The application still normalizes allowed fields;
  // exact byte equality, not these decoded values, is the restore authority.
  const firstValues = new Map();
  for (const [key, item] of new URLSearchParams(parsed.query)) if (!firstValues.has(key)) firstValues.set(key, item);
  return {
    ...summary, status: "VALID_V1", revision: typeof parsed.revision === "string" ? parsed.revision : null,
    query: parsed.query, decodedQuery: [...firstValues].sort(([left], [right]) => left.localeCompare(right)),
  };
}

function querySelectionInput(summary, legacyValue) {
  if (summary.status === "VALID_V1") return { source: "LIST_V1_BEFORE_APP_NORMALIZATION", queryInput: summary.query };
  if (summary.status === "OVERSIZED_NOT_DECODED") return { source: "NOT_DECODED", queryInput: null };
  if (summary.status === "MISSING") return { source: legacyValue === "table" ? "CURRENT_LEGACY_TABLE" : "DEFAULT_OR_CURRENT_LEGACY_KANBAN", queryInput: legacyValue === "table" ? "view=table" : "view=kanban" };
  return { source: "DEFAULT_INVALID_LIST_IGNORES_LEGACY", queryInput: "view=kanban" };
}

function preferenceDiagnostics(checkpoint, writes, rows, legacyRows) {
  const current = new Map(rows.map((row) => [preferenceId(row), row.value]));
  const legacy = new Map(legacyRows.map((row) => [preferenceId(row), row.value]));
  const labels = new Map(Object.entries(checkpoint.profiles).map(([label, profile]) => [profile.id, label]));
  return checkpoint.originalPreferences.map((original) => {
    const key = preferenceId(original);
    const value = current.get(key) ?? null;
    const hasRecorded = writes.has(key);
    const last = hasRecorded ? writes.get(key) : null;
    const legacyKey = original.key.replace(/\.list$/, ".view");
    const legacyValue = legacy.get(preferenceId({ userId: original.userId, key: legacyKey })) ?? null;
    const currentSummary = describePreference(value);
    const originalSummary = describePreference(original.value);
    const recordedSummary = hasRecorded ? describePreference(last) : null;
    const equalOriginal = value === original.value;
    const equalRecorded = hasRecorded ? value === last : null;
    return {
      profile: labels.get(original.userId), userId: original.userId, key: original.key,
      status: equalOriginal ? "ORIGINAL_UNCHANGED" : equalRecorded ? "LAST_RECORDED_MATCH" : "CONFLICT_UNVERIFIED_VALUE",
      ownership: equalOriginal ? "NO_RESTORE_NEEDED" : equalRecorded ? "EXACT_LAST_RECORDED_RESPONSE" : "NOT_ESTABLISHED",
      equalities: {
        currentEqualsOriginal: equalOriginal, hasLastRecorded: hasRecorded, currentEqualsLastRecorded: equalRecorded,
        originalEqualsLastRecorded: hasRecorded ? original.value === last : null,
        sameDecodedQueryAsLastRecorded: recordedSummary?.status === "VALID_V1" && currentSummary.status === "VALID_V1"
          ? canonical(recordedSummary.decodedQuery) === canonical(currentSummary.decodedQuery) : null,
      },
      currentRevision: currentSummary.revision,
      original: originalSummary, lastRecorded: recordedSummary, current: currentSummary,
      legacyView: {
        key: legacyKey, checkpointed: false,
        status: legacyValue === null ? "MISSING" : ["table", "kanban"].includes(legacyValue) ? "RECOGNIZED" : "UNRECOGNIZED",
        value: ["table", "kanban"].includes(legacyValue) ? legacyValue : null,
        sha256: legacyValue === null ? null : createHash("sha256").update(legacyValue).digest("hex"),
        fallbackQueryWhenListMissing: legacyValue === "table" ? "view=table" : "view=kanban",
      },
      currentQuerySelection: querySelectionInput(currentSummary, legacyValue),
      originalQuerySelectionUsingCurrentLegacy: querySelectionInput(originalSummary, legacyValue),
    };
  });
}

async function inspect(db, secret, checkpoint, ownWrites) {
  const originals = validateCheckpoint(checkpoint, secret);
  const writes = validateOwnWrites(originals, ownWrites);
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await databaseGuard(tx, true);
    const ids = Object.values(checkpoint.profiles).map((profile) => profile.id);
    const [rows, legacyRows, users] = await Promise.all([
      tx.userPreference.findMany({ where: { OR: originals.map(({ userId, key }) => ({ userId, key })) }, select: { userId: true, key: true, value: true } }),
      tx.userPreference.findMany({ where: { OR: originals.map(({ userId, key }) => ({ userId, key: key.replace(/\.list$/, ".view") })) }, select: { userId: true, key: true, value: true } }),
      tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, roles: true, active: true } }),
    ]);
    const preferences = preferenceDiagnostics(checkpoint, writes, rows, legacyRows);
    const identities = Object.entries(checkpoint.profiles).map(([profile, original]) => {
      const current = users.find((user) => user.id === original.id);
      return { profile, userId: original.id, status: !current ? "MISSING" : current.active && sameRoles(current.roles, original.roles) ? "UNCHANGED" : "CHANGED" };
    });
    const currentBaseline = await snapshots(tx);
    const baselineMatches = canonical(currentBaseline) === canonical(checkpoint.baseline);
    const conflicts = preferences.filter((row) => row.status === "CONFLICT_UNVERIFIED_VALUE").length;
    await databaseGuard(tx, true);
    return {
      status: "INSPECTED", readOnly: true,
      counts: { checked: originals.length, originalUnchanged: preferences.filter((row) => row.status === "ORIGINAL_UNCHANGED").length, lastRecordedMatch: preferences.filter((row) => row.status === "LAST_RECORDED_MATCH").length, conflicts },
      restoreAllowedByRecordedValues: baselineMatches && conflicts === 0 && identities.every((identity) => identity.status === "UNCHANGED"),
      preferences, identities,
      dataIntegrity: { status: baselineMatches ? "MATCH" : "MISMATCH", businessTableCount: 13, auditAndTimeTableCount: 2, baseline: checkpoint.baseline, current: currentBaseline },
    };
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 });
}

async function prepare(db, secret) {
  const source = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await databaseGuard(tx, true);
    const users = await tx.user.findMany({ where: { active: true }, select: { id: true, roles: true, sessionVersion: true }, orderBy: { id: "asc" } });
    const manager = users.find((user) => sameRoles(user.roles, ["MANAGER"]));
    const combined = users.find((user) => sameRoles(user.roles, ["MANAGER", "ENGINEER"]));
    const engineerCandidates = users.filter((user) => sameRoles(user.roles, ["ENGINEER"]));
    requireThat(manager && engineerCandidates.length, "EXISTING_ROLE_COHORT_MISSING");
    const [projects, products] = await Promise.all([
      tx.project.findMany({ select: { id: true, title: true }, orderBy: { id: "asc" } }),
      tx.product.findMany({ select: { id: true, number: true, title: true, status: true, engineerId: true }, orderBy: { id: "asc" } }),
    ]);
    const engineer = engineerCandidates.find((user) => products.some((product) => product.engineerId === user.id && product.status === "DESIGN"));
    requireThat(engineer && projects.length && products.length, "EXISTING_DESIGN_OR_LONG_TITLE_COHORT_MISSING");
    const ownProducts = products.filter((product) => product.engineerId === engineer.id && product.status === "DESIGN");
    const longest = (rows) => rows.reduce((result, row) => row.title.length > result.title.length ? row : result);
    const project = longest(projects);
    const product = longest(products);
    const ownProduct = longest(ownProducts);
    const actors = { manager, ...(combined ? { combined } : {}), engineer };
    const profileKeys = PROFILE_KEYS.filter((key) => key in actors);
    const userIds = profileKeys.map((key) => actors[key].id);
    const [preferences, timers] = await Promise.all([
      tx.userPreference.findMany({ where: { userId: { in: userIds }, key: { in: PREF_KEYS } }, select: { userId: true, key: true, value: true } }),
      tx.timeEntry.findMany({ where: { userId: { in: userIds }, stoppedAt: null }, select: { userId: true } }),
    ]);
    const originals = userIds.flatMap((userId) => PREF_KEYS.map((key) => ({ userId, key, value: preferences.find((row) => row.userId === userId && row.key === key)?.value ?? null })));
    return {
      actors,
      availability: { combined: Boolean(combined) },
      activeTimerUsers: new Set(timers.map((timer) => timer.userId)),
      originals,
      paths: { project: `/projects/${encodeURIComponent(project.id)}`, product: `/products/${encodeURIComponent(product.number)}`, engineerProduct: `/products/${encodeURIComponent(ownProduct.number)}` },
      expected: {
        engineerProductNumber: ownProduct.number,
        engineerProductCount: ownProducts.length,
        engineerProducts: ownProducts.map(({ id, number, status, engineerId }) => ({ id, number, status, engineerId })),
        titleLengths: { project: project.title.length, product: product.title.length, engineerProduct: ownProduct.title.length },
      },
      baseline: await snapshots(tx),
    };
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 });
  const profiles = {};
  const identities = {};
  for (const key of PROFILE_KEYS.filter((key) => key in source.actors)) {
    const actor = source.actors[key];
    const cookies = await Promise.all(["authjs.session-token", "__Secure-authjs.session-token"].map(async (name) => ({
      name, value: await encode({ secret, salt: name, token: { id: actor.id, roles: actor.roles, sessionVersion: actor.sessionVersion }, maxAge: 15 * 60 }),
    })));
    profiles[key] = { id: actor.id, roles: actor.roles, cookies, canVisitMy: !source.activeTimerUsers.has(actor.id) };
    identities[key] = { id: actor.id, roles: actor.roles };
  }
  const checkpoint = {
    version: 1, namespace: NAMESPACE, runId: randomUUID(), issuedAt: new Date().toISOString(),
    profiles: identities, availability: source.availability, originalPreferences: source.originals, baseline: source.baseline,
  };
  checkpoint.signature = checkpointSignature(checkpoint, secret);
  validateCheckpoint(checkpoint, secret);
  // Conservative budget for every allowed key at the maximum response length.
  // URLSearchParams response queries are ASCII and never contain JSON quotes or
  // backslashes; the fixed JSON wrapper below overestimates their escaping cost.
  const maximumWrites = source.originals.map(({ userId, key }) => ({ userId, key, value: JSON.stringify({ version: 1, revision: "00000000-0000-0000-0000-000000000000", query: `q=${"x".repeat(8192)}` }) }));
  const restoreSkeleton = { operation: "restore", checkpoint, ownWrites: maximumWrites };
  requireThat(Buffer.byteLength(Buffer.from(JSON.stringify(restoreSkeleton)).toString("base64"), "ascii") <= MAX_INPUT, "CHECKPOINT_TOO_LARGE_FOR_PRIVATE_TRANSPORT");
  return {
    status: "PREPARED", checkpoint, profiles, paths: source.paths, expected: source.expected,
    originalPreferences: source.originals, availability: source.availability,
    sessionExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

async function restore(db, secret, checkpoint, ownWrites) {
  const originals = validateCheckpoint(checkpoint, secret);
  const writes = validateOwnWrites(originals, ownWrites);
  return db.$transaction(async (tx) => {
    await databaseGuard(tx, false);
    const profileKeys = Object.keys(checkpoint.profiles);
    const ids = profileKeys.map((key) => checkpoint.profiles[key].id);
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, roles: true, active: true, sessionVersion: true } });
    requireThat(users.length === ids.length, "ORIGINAL_USERS_MISSING");
    for (const key of profileKeys) {
      const original = checkpoint.profiles[key];
      const current = users.find((user) => user.id === original.id);
      requireThat(current?.active && sameRoles(current.roles, original.roles), "USER_IDENTITY_CHANGED");
    }
    const before = await snapshots(tx);
    requireThat(canonical(before) === canonical(checkpoint.baseline), "BUSINESS_AUDIT_OR_TIME_CHANGED_BEFORE_RESTORE");
    // Lock only the four/six exact preference keys. Missing rows are covered by the
    // serializable predicate; no unrelated rows or whole tables are locked.
    const sorted = [...originals].sort((a, b) => preferenceId(a).localeCompare(preferenceId(b)));
    const placeholders = sorted.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(",");
    const values = sorted.flatMap((row) => [row.userId, row.key]);
    const rows = await tx.$queryRawUnsafe(`SELECT "userId", "key", "value" FROM "UserPreference" WHERE ("userId", "key") IN (${placeholders}) ORDER BY "userId", "key" FOR UPDATE`, ...values);
    const plan = buildRestorePlan(originals, writes, rows);
    const counts = { checked: originals.length, unchanged: 0, restored: 0, deleted: 0 };
    for (const row of plan) {
      if (row.action === "noop") { counts.unchanged++; continue; }
      const where = { userId: row.userId, key: row.key, value: row.expectedOwnValue };
      const changed = row.action === "delete"
        ? await tx.userPreference.deleteMany({ where })
        : await tx.userPreference.updateMany({ where, data: { value: row.value } });
      requireThat(changed.count === 1, "PREFERENCE_CAS_RACE");
      counts[row.action === "delete" ? "deleted" : "restored"]++;
    }
    const restoredRows = await tx.userPreference.findMany({ where: { OR: originals.map(({ userId, key }) => ({ userId, key })) }, select: { userId: true, key: true, value: true } });
    const restoredValues = new Map(restoredRows.map((row) => [preferenceId(row), row.value]));
    requireThat(originals.every((row) => (restoredValues.get(preferenceId(row)) ?? null) === row.value), "PREFERENCE_RESTORE_VERIFICATION_FAILED");
    const after = await snapshots(tx);
    requireThat(canonical(after) === canonical(before) && canonical(after) === canonical(checkpoint.baseline), "BUSINESS_AUDIT_OR_TIME_CHANGED_DURING_RESTORE");
    await databaseGuard(tx, false);
    return { status: "RESTORED", counts, dataIntegrity: { status: "PASS", businessTableCount: 13, auditAndTimeTableCount: 2, before, after } };
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 });
}

async function main() {
  let db;
  let operation = "UNKNOWN";
  try {
    const input = readEnvelope();
    operation = input.operation;
    const secret = environmentGuard();
    // Validate authenticated diagnostic/cleanup scope BEFORE a database client.
    if (operation !== "prepare") validateOwnWrites(validateCheckpoint(input.checkpoint, secret), input.ownWrites);
    db = new PrismaClient({ log: [], errorFormat: "minimal" });
    const result = operation === "prepare" ? await prepare(db, secret)
      : operation === "inspect" ? await inspect(db, secret, input.checkpoint, input.ownWrites)
        : await restore(db, secret, input.checkpoint, input.ownWrites);
    await db.$disconnect();
    db = undefined;
    // prepare output intentionally contains credentials: only the private root
    // transport may consume it. No progress/debug output is emitted alongside it.
    console.log(JSON.stringify(result));
  } catch (error) {
    const failure = { status: "FAIL", operation, code: error instanceof SafeFailure ? error.code : "OPERATION_FAILED" };
    console.error(JSON.stringify(failure));
    console.log(JSON.stringify(failure));
    process.exitCode = 1;
  } finally {
    if (db) await db.$disconnect().catch(() => {});
  }
}

await main();
