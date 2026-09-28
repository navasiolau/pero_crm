/**
 * App-layer acceptance for the four first-wave changes, existing staging data only.
 * Root MUST prove crm-staging hostname, exact Docker/DB identity and image revision
 * outside this process, then feed this file (or its bundle) to the RUNNING web app:
 *   docker exec -i -w /app/apps/web <verified-web-container> node --input-type=module
 * Never start a server, install dependencies, create fixtures or run migrations here.
 * If @auth/core/jwt is bundled away in the image, bundle this file LOCALLY with
 * esbuild (platform=node, format=esm, external @prisma/client) and feed that bundle.
 * JWTs and the existing AUTH_SECRET stay in this process; no password login claim.
 * HTTP is socket-bound to loopback, GET-only, and NEVER follows a redirect.
 * /my is deliberately never fetched: its timer read can auto-stop expired entries.
 * Filter saving and mobile visual acceptance require separate acceptance evidence.
 */
import { request as nodeRequest } from "node:http";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";

const businessTables = ["User", "Client", "Project", "Product", "Task", "Work", "File", "Payment", "Payout", "PayrollEntry", "Material", "ProjectMaterial", "StockMovement"];
const auditAndTimeTables = ["ChangeLog", "TimeEntry"];
const requiredRoles = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT", "WORKER", "MOUNTER"];
const homeByRole = { ADMIN: "/", DIRECTOR: "/", MANAGER: "/", ENGINEER: "/products", ACCOUNTANT: "/finance", WORKER: "/my", MOUNTER: "/my", MANAGER_ENGINEER: "/" };
const base = new URL("http://127.0.0.1:3000");
const maxSmallFile = 256 * 1024;
const checks = [];
let phase = "ENVIRONMENT_GUARD";

class CheckFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function check(condition, code) { if (!condition) throw new CheckFailure(code); }
function sameSet(actual, expected, code) {
  check(actual.size === expected.size && [...actual].every((value) => expected.has(value)), code);
}
async function verify(name, fn) {
  phase = name;
  const counts = await fn();
  checks.push({ check: name, status: "PASS", ...counts });
}

function environmentGuard() {
  check(process.env.S3_BUCKET === "pero-crm-staging", "STAGING_BUCKET_REQUIRED");
  check(Boolean(process.env.S3_ENDPOINT), "STAGING_STORAGE_REQUIRED");
  let url;
  try { url = new URL(process.env.DATABASE_URL ?? ""); } catch { throw new CheckFailure("DATABASE_URL_INVALID"); }
  check(["postgres:", "postgresql:"].includes(url.protocol), "POSTGRES_REQUIRED");
  check(url.hostname === "db" && decodeURIComponent(url.pathname) === "/crm", "STAGING_DATABASE_REQUIRED");
  check(!url.port || url.port === "5432", "STAGING_DATABASE_PORT_REQUIRED");
  check(!url.hash, "DATABASE_URL_FRAGMENT_FORBIDDEN");
  // Prevent alternate socket/host parameters from defeating the hostname guard.
  const allowedOptions = new Set(["schema", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "sslmode"]);
  check([...url.searchParams.keys()].every((key) => allowedOptions.has(key)), "DATABASE_URL_OPTIONS_NOT_ALLOWLISTED");
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  check(typeof secret === "string" && secret.length > 0, "AUTH_SECRET_REQUIRED");
  return secret;
}

async function readOnly(db, fn) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const [identity] = await tx.$queryRawUnsafe("SELECT current_database() AS name, current_setting('transaction_read_only') AS readonly");
    check(identity?.name === "crm" && identity.readonly === "on", "READ_ONLY_DATABASE_IDENTITY_MISMATCH");
    return fn(tx);
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 });
}

async function snapshot(tx, tables) {
  const result = {};
  for (const table of tables) {
    // Identifiers are from the fixed allowlists above, never from environment/data.
    const [row] = await tx.$queryRawUnsafe(`SELECT count(*)::integer AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id), '')) AS hash FROM "${table}" t`);
    result[table] = row;
  }
  return result;
}

async function snapshots(tx) {
  return { business: await snapshot(tx, businessTables), auditAndTime: await snapshot(tx, auditAndTimeTables) };
}

function get(route, cookie, extraHeaders = {}, limit = 16 * 1024 * 1024) {
  check(route.startsWith("/") && !route.startsWith("//"), "LOCAL_RELATIVE_ROUTE_REQUIRED");
  check(!/^\/(?:my|finance)(?:[/?]|$)/.test(route), "SIDE_EFFECTFUL_OR_FINANCE_PAGE_FORBIDDEN");
  return new Promise((resolve, reject) => {
    const req = nodeRequest({
      hostname: "127.0.0.1", port: 3000, method: "GET", path: route,
      headers: { host: "127.0.0.1:3000", ...(cookie ? { cookie } : {}), ...extraHeaders },
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > limit) {
          req.destroy(new CheckFailure("HTTP_BODY_LIMIT_EXCEEDED"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", () => reject(new CheckFailure("HTTP_RESPONSE_FAILED")));
      res.on("aborted", () => reject(new CheckFailure("HTTP_RESPONSE_ABORTED")));
    });
    req.setTimeout(30_000, () => req.destroy(new CheckFailure("HTTP_TIMEOUT")));
    req.on("error", (error) => reject(error instanceof CheckFailure ? error : new CheckFailure("LOOPBACK_HTTP_FAILED")));
    req.end();
  });
}

function jsonBody(response) {
  try { return JSON.parse(response.body.toString("utf8")); } catch { throw new CheckFailure("JSON_RESPONSE_REQUIRED"); }
}

function redirect(response, expectedPath) {
  check([302, 303, 307, 308].includes(response.status), "REDIRECT_REQUIRED");
  check(typeof response.headers.location === "string", "REDIRECT_LOCATION_REQUIRED");
  let target;
  try { target = new URL(response.headers.location, base); } catch { throw new CheckFailure("REDIRECT_LOCATION_INVALID"); }
  check(target.pathname === expectedPath, "REDIRECT_PATH_MISMATCH");
  // AUTH_URL can deliberately use the public staging HTTPS origin. Never follow it.
  return target;
}

async function signedCookies(actor, secret, versionOffset = 0) {
  const token = { id: actor.id, roles: actor.roles, sessionVersion: actor.sessionVersion + versionOffset };
  const names = ["authjs.session-token", "__Secure-authjs.session-token"];
  const cookies = await Promise.all(names.map(async (name) => `${name}=${await encode({ secret, salt: name, token, maxAge: 120 })}`));
  return cookies.join("; ");
}

function productQueryMatches(product, query) {
  const needle = query.toLocaleLowerCase();
  return product.number.toLocaleLowerCase().includes(needle) || product.title.toLocaleLowerCase().includes(needle);
}

async function selectContext(tx) {
  const [users, products, projects, tasks, clients, files] = await Promise.all([
    tx.user.findMany({ where: { active: true }, select: { id: true, roles: true, sessionVersion: true }, orderBy: { id: "asc" } }),
    tx.product.findMany({ select: { id: true, number: true, title: true, projectId: true, engineerId: true, status: true } }),
    tx.project.findMany({ select: { id: true, clientId: true } }),
    tx.task.findMany({ select: { id: true, projectId: true, productId: true } }),
    tx.client.findMany({ select: { id: true, name: true, lastName: true, middleName: true, phone: true } }),
    tx.file.findMany({ select: { id: true, projectId: true, productId: true, taskId: true, size: true, hasThumb: true }, orderBy: { size: "asc" } }),
  ]);
  const actors = new Map();
  for (const role of requiredRoles) {
    const actor = users.find((user) => user.roles.length === 1 && user.roles[0] === role);
    check(actor, "EXISTING_ROLE_COHORT_MISSING");
    actors.set(role, actor);
  }
  const managerEngineer = users.find((user) => user.roles.includes("MANAGER") && user.roles.includes("ENGINEER"));
  if (managerEngineer) actors.set("MANAGER_ENGINEER", managerEngineer);
  // Exact-number search must fit the API's six-row result cap, otherwise presence
  // of a chosen target would be a flaky assertion rather than an access check.
  const searchable = (product) => product.number.length >= 2 && products.filter((row) => productQueryMatches(row, product.number)).length <= 6;
  let cohort;
  for (const engineer of users.filter((user) => user.roles.length === 1 && user.roles[0] === "ENGINEER")) {
    const own = products.find((product) => product.engineerId === engineer.id && product.status === "DESIGN" && searchable(product));
    const foreign = products.find((product) => product.engineerId !== null && product.engineerId !== engineer.id && product.status === "DESIGN" && searchable(product));
    const later = products.find((product) => product.engineerId === engineer.id && product.status !== "DESIGN" && searchable(product));
    if (!own || !foreign || !later) continue;
    const allowedProducts = new Set(products.filter((product) => product.engineerId === engineer.id && product.status === "DESIGN").map((product) => product.id));
    const allowedProjects = new Set(products.filter((product) => allowedProducts.has(product.id)).map((product) => product.projectId));
    const allowedTasks = new Set(tasks.filter((task) => allowedProducts.has(task.productId)).map((task) => task.id));
    const allowedClients = new Set(projects.filter((project) => allowedProjects.has(project.id)).map((project) => project.clientId));
    const hiddenFile = files.find((file) => !allowedProjects.has(file.projectId) ||
      (file.productId !== null && !allowedProducts.has(file.productId)) ||
      (file.taskId !== null && !allowedTasks.has(file.taskId)));
    if (!hiddenFile) continue;
    const clientMatches = (client, query) => [client.name, client.lastName, client.middleName, client.phone].some((value) => value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    let hiddenClientQuery;
    for (const client of clients.filter((row) => !allowedClients.has(row.id))) {
      const query = [client.phone, client.lastName, client.name].find((value) => value?.trim().length >= 2 && clients.filter((row) => clientMatches(row, value.trim())).length <= 4);
      if (query) { hiddenClientQuery = query.trim(); break; }
    }
    if (!hiddenClientQuery) continue;
    cohort = { engineer, own, foreign, later, allowedProducts, allowedProjects, allowedTasks, allowedClients, hiddenFile, hiddenClientQuery };
    break;
  }
  check(cohort, "EXISTING_ENGINEER_PRODUCT_FILE_CLIENT_COHORT_MISSING");
  actors.set("ENGINEER", cohort.engineer);
  const smallFile = files.find((file) => file.size > 0 && file.size <= maxSmallFile);
  check(smallFile, "EXISTING_SMALL_FILE_MISSING");
  return { actors, products, projects, clients, cohort, smallFile, activeUsers: users.length };
}

// Parse structured React Flight models, never arbitrary JavaScript and never
// blanket-match entity names in page text (common project correspondence is allowed).
function flightObjects(response) {
  check(response.status === 200, "RSC_PAGE_200_REQUIRED");
  check(String(response.headers["content-type"] ?? "").includes("text/x-component"), "RSC_CONTENT_TYPE_REQUIRED");
  const models = new Map();
  for (const line of response.body.toString("utf8").split("\n")) {
    const match = /^([0-9a-f]+):(.*)$/i.exec(line);
    if (!match) continue;
    try { models.set(match[1], JSON.parse(match[2])); } catch { /* Import/text/console records are not model JSON. */ }
  }
  const objects = [];
  const seen = new Set();
  const seenReferences = new Set();
  function visit(value) {
    if (typeof value === "string" && /^\$[0-9a-f]+$/i.test(value)) {
      if (seenReferences.has(value)) return;
      seenReferences.add(value);
      visit(models.get(value.slice(1)));
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    objects.push(value);
    Object.values(value).forEach(visit);
  }
  models.forEach(visit);
  return { objects, resolve: (value) => typeof value === "string" && /^\$[0-9a-f]+$/i.test(value) ? models.get(value.slice(1)) : value };
}

function productRows(response) {
  const flight = flightObjects(response);
  const views = flight.objects.filter((item) => typeof item.total === "number" && typeof item.page === "number" && "products" in item);
  check(views.length > 0, "PRODUCTS_VIEW_MODEL_REQUIRED");
  const result = views.map((view) => ({ rows: flight.resolve(view.products), total: view.total }));
  check(result.every((view) => Array.isArray(view.rows)), "PRODUCT_ROWS_ARRAY_REQUIRED");
  return result;
}

async function runChecks(context, secret) {
  const counts = { actors: context.actors.size, combinedRoleProfiles: context.actors.has("MANAGER_ENGINEER") ? 1 : 0, activeUsers: context.activeUsers, products: context.products.length, projects: context.projects.length };
  if (!context.actors.has("MANAGER_ENGINEER")) checks.push({ check: "MANAGER_ENGINEER_COMBINED_ROLE", status: "NOT_AVAILABLE", count: 0 });
  for (const [role, actor] of context.actors) {
    await verify(`SESSION_AND_HOME_${role}`, async () => {
      const cookie = await signedCookies(actor, secret);
      const response = await get("/api/auth/session", cookie);
      check(response.status === 200, "SESSION_200_REQUIRED");
      const session = jsonBody(response);
      check(session?.user?.id === actor.id, "CURRENT_USER_ID_MISMATCH");
      sameSet(new Set(session.user.roles), new Set(actor.roles), "CURRENT_ROLES_MISMATCH");
      const home = homeByRole[role];
      const root = await get("/", cookie);
      if (home === "/") check(root.status === 200, "MANAGEMENT_DASHBOARD_200_REQUIRED");
      else redirect(root, home);
      redirect(await get("/login", cookie), home);
      // Do not follow /my or /finance: this tests routing without timer/finance work.
      if (role === "DIRECTOR") redirect(await get("/payroll", cookie), "/");
      const invalid = await get("/api/auth/session", await signedCookies(actor, secret, 1));
      check(invalid.status === 200 && jsonBody(invalid) === null, "MISMATCHED_VERSION_MUST_BE_REJECTED");
      return { count: 1 };
    });
  }
  const { cohort } = context;
  const engineerCookie = await signedCookies(cohort.engineer, secret);
  const managerCookie = await signedCookies(context.actors.get("MANAGER_ENGINEER") ?? context.actors.get("MANAGER"), secret);
  await verify("ENGINEER_PRODUCT_PAGES_AND_MANAGER_VISIBILITY", async () => {
    for (const [product, engineerStatus] of [[cohort.own, 200], [cohort.foreign, 404], [cohort.later, 404]]) {
      const route = `/products/${encodeURIComponent(product.number)}`;
      check((await get(route, engineerCookie)).status === engineerStatus, "ENGINEER_PRODUCT_PAGE_STATUS_MISMATCH");
      check((await get(route, managerCookie)).status === 200, "MANAGER_PRODUCT_ACCESS_MISMATCH");
    }
    return { count: 6 };
  });
  await verify("ENGINEER_SEARCH_IDS_AND_CLIENT_SCOPE", async () => {
    for (const query of [cohort.own.number, cohort.foreign.number, cohort.later.number, cohort.hiddenClientQuery]) {
      const response = await get(`/api/search?q=${encodeURIComponent(query)}`, engineerCookie);
      check(response.status === 200, "SEARCH_200_REQUIRED");
      const body = jsonBody(response);
      for (const [field, allowed] of [["products", cohort.allowedProducts], ["projects", cohort.allowedProjects], ["tasks", cohort.allowedTasks], ["clients", cohort.allowedClients]]) {
        check(Array.isArray(body[field]) && body[field].every((row) => allowed.has(row.id)), "SEARCH_RETURNED_HIDDEN_ENTITY");
      }
      if (query === cohort.own.number) check(body.products.some((row) => row.id === cohort.own.id), "OWN_SEARCH_RESULT_REQUIRED");
    }
    for (const product of [cohort.foreign, cohort.later]) {
      const body = jsonBody(await get(`/api/search?q=${encodeURIComponent(product.number)}`, managerCookie));
      check(body.products?.some((row) => row.id === product.id), "MANAGER_SEARCH_RESULT_REQUIRED");
    }
    return { count: 6 };
  });
  await verify("ENGINEER_STRUCTURED_LIST_AND_CLIENT_PROPS", async () => {
    for (const view of productRows(await get("/products?view=kanban&active=0", engineerCookie, { RSC: "1" }))) {
      sameSet(new Set(view.rows.map((row) => row.id)), cohort.allowedProducts, "ENGINEER_LIST_IDS_MISMATCH");
      check(view.total === cohort.allowedProducts.size, "ENGINEER_LIST_TOTAL_MISMATCH");
    }
    for (const view of productRows(await get(`/products?view=kanban&active=0&status=${encodeURIComponent(cohort.later.status)}`, engineerCookie, { RSC: "1" }))) {
      check(view.rows.length === 0 && view.total === 0, "EXPLICIT_FILTER_MUST_NOT_EXPAND_ACCESS");
    }
    const focusId = [...cohort.allowedClients][0];
    check(focusId, "VISIBLE_CLIENT_REQUIRED");
    const flight = flightObjects(await get(`/clients?focus=${encodeURIComponent(focusId)}`, engineerCookie, { RSC: "1" }));
    const views = flight.objects.filter((item) => item.focusClientId === focusId && "clients" in item);
    check(views.length > 0, "CLIENTS_VIEW_MODEL_REQUIRED");
    for (const view of views) {
      const clients = flight.resolve(view.clients);
      check(Array.isArray(clients), "CLIENT_ROWS_ARRAY_REQUIRED");
      sameSet(new Set(clients.map((row) => row.id)), cohort.allowedClients, "CLIENT_PAGE_IDS_MISMATCH");
      for (const client of clients) {
        check(Array.isArray(client.projects) && client.projects.every((project) => cohort.allowedProjects.has(project.id)), "CLIENT_PAGE_RETURNED_HIDDEN_PROJECT");
        check(client.projectsCount === client.projects.length, "CLIENT_PROJECT_COUNT_MISMATCH");
      }
    }
    return { count: 3 };
  });
  await verify("LIST_RETURN_REDIRECTS_READ_ONLY", async () => {
    const productsBefore = redirect(await get("/products", managerCookie), "/products");
    const projectsBefore = redirect(await get("/projects", managerCookie), "/projects");
    check(productsBefore.searchParams.has("view") && projectsBefore.searchParams.has("view"), "CANONICAL_LIST_QUERY_REQUIRED");
    const productsAfter = redirect(await get("/products", managerCookie), "/products");
    const projectsAfter = redirect(await get("/projects", managerCookie), "/projects");
    check(productsBefore.search === productsAfter.search && projectsBefore.search === projectsAfter.search, "LIST_STATE_CHANGED_ON_RETURN");
    return { count: 4 };
  });
  await verify("HIDDEN_FILE_AND_THUMB_DENIED_BEFORE_STORAGE", async () => {
    for (const suffix of ["", "?thumb=1"]) {
      const response = await get(`/api/files/${encodeURIComponent(cohort.hiddenFile.id)}${suffix}`, engineerCookie);
      check(response.status === 404, "HIDDEN_FILE_404_REQUIRED");
      const body = jsonBody(response);
      check(body?.error === "Файл не найден", "FILE_POLICY_DENIAL_REQUIRED_NOT_MISSING_BYTES");
    }
    return { count: 2 };
  });
  await verify("AUTHORIZED_EXISTING_SMALL_FILE_READ", async () => {
    const response = await get(`/api/files/${encodeURIComponent(context.smallFile.id)}`, managerCookie, {}, maxSmallFile);
    check(response.status === 200, "EXISTING_FILE_200_REQUIRED");
    check(response.body.length === context.smallFile.size, "EXISTING_FILE_LENGTH_MISMATCH");
    check(response.headers["cache-control"] === "private, no-store", "PRIVATE_FILE_CACHE_POLICY_REQUIRED");
    return { count: 1, bytes: response.body.length, sha256: createHash("sha256").update(response.body).digest("hex") };
  });
  return counts;
}

async function main() {
  let db;
  let before;
  let after;
  let counts;
  let failure;
  try {
    const secret = environmentGuard();
    db = new PrismaClient({ log: [], errorFormat: "minimal" });
    phase = "READ_ONLY_EXISTING_DATA_SELECTION";
    const initial = await readOnly(db, async (tx) => ({ context: await selectContext(tx), before: await snapshots(tx) }));
    before = initial.before;
    counts = await runChecks(initial.context, secret);
  } catch (error) {
    failure = { check: phase, code: error instanceof CheckFailure ? error.code : "UNEXPECTED_ERROR" };
  } finally {
    if (db && before) {
      try {
        after = await readOnly(db, snapshots);
        if (JSON.stringify(before) !== JSON.stringify(after)) failure ??= { check: "DATA_INTEGRITY", code: "BUSINESS_AUDIT_OR_TIME_CHANGED" };
      } catch {
        failure ??= { check: "DATA_INTEGRITY", code: "AFTER_SNAPSHOT_FAILED" };
      }
    }
    if (db) await db.$disconnect().catch(() => { failure ??= { check: "DATABASE_DISCONNECT", code: "DISCONNECT_FAILED" }; });
  }
  const dataUnchanged = Boolean(before && after && JSON.stringify(before) === JSON.stringify(after));
  const result = {
    status: failure ? "FAIL" : "PASS",
    scope: "APP_LAYER_HTTP_READ_ONLY",
    outerDeploymentIdentityAndRevision: "ROOT_WRAPPER_PROOF_REQUIRED",
    authentication: "SIGNED_EXISTING_USER_SESSIONS",
    passwordLogin: "NOT_TESTED",
    publicHttpsBasicAuth: "NOT_TESTED",
    mobileVisualAcceptance: "NOT_TESTED",
    filterSaveMutation: "NOT_TESTED",
    checks,
    counts: counts ?? { completedChecks: checks.length },
    dataIntegrity: { status: dataUnchanged ? "PASS" : "NOT_CONFIRMED", businessTableCount: businessTables.length, auditAndTimeTableCount: auditAndTimeTables.length, before, after },
    ...(failure ? { failure } : {}),
  };
  if (failure) console.error(JSON.stringify({ status: "FAIL", check: failure.check, code: failure.code }));
  console.log(JSON.stringify(result));
  if (failure) process.exitCode = 1;
}

await main();
