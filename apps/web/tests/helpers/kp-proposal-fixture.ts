import type { Prisma } from "@prisma/client";
import type { MutationTransaction } from "../../src/server/transactions/coordinator";

export type FixtureRow = { id: string } & Record<string, unknown>;
type Filter = Record<string, unknown>;
type Write = { data: Record<string, unknown>; where?: Filter };
const clone = <T>(value: T): T => structuredClone(value);
const defined = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
function matches(row: FixtureRow, where: Filter = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const condition = value as { in?: unknown[]; notIn?: unknown[] };
      if (condition.in) return condition.in.includes(row[key]);
      if (condition.notIn) return !condition.notIn.includes(row[key]);
    }
    return value === null ? row[key] == null : row[key] === value;
  });
}

/** Только DI: callback rollback/serialization моделируются без подключения к БД. */
export function proposalFixture() {
  let beforeProductLock: (() => void) | undefined;
  const client = (id: string, name: string): FixtureRow => ({ id, name, lastName: null, middleName: null,
    phone: "+375000000000", email: null, address: null, comment: null, passportNumber: null, passportIssuedBy: null,
    legacyId: null, legacyTable: null, createdAt: new Date(0), updatedAt: new Date(0) });
  const state = {
    clients: [client("temporary", "Временный"), { ...client("customer", "Имя"), lastName: "Фамилия", middleName: "Отчество" }],
    projects: [{ id: "230", number: "230", numberInt: 230, stage: "LEAD", deletedAt: new Date(0), title: "Исторический проект", clientId: "customer", currency: "BYN" }] as FixtureRow[],
    products: [] as FixtureRow[], proposals: [] as FixtureRow[], items: [] as FixtureRow[],
    logs: [] as FixtureRow[], events: [] as FixtureRow[], stageHistory: [] as FixtureRow[], statusHistory: [] as FixtureRow[],
    works: [] as FixtureRow[], materials: [] as FixtureRow[], financialFacts: [] as FixtureRow[],
    sql: [] as string[], writes: [] as string[], sequence: 0, pricingCalls: 0,
    failEventType: "", forceCasFailure: false, warehousePhase: "ACTIVE",
  };
  type Rows = typeof state.clients;
  const sequence = (prefix: string) => `${prefix}-${++state.sequence}`;
  const uniqueNumber = (row: FixtureRow) => {
    if (row.deletedAt == null && state.products.some(other => other.id !== row.id && other.deletedAt == null && other.number === row.number))
      throw Error("ACTIVE_PRODUCT_NUMBER_CONFLICT");
  };
  const validItemPosition = (row: FixtureRow) => {
    if (!Number.isInteger(row.position) || Number(row.position) < 1 || Number(row.position) > 2_147_483_647) throw Error("PROPOSAL_ITEM_POSITION_CHECK");
    if (row.deletedAt == null && state.items.some(other => other.id !== row.id && other.deletedAt == null && other.proposalId === row.proposalId && other.position === row.position))
      throw Error("ACTIVE_PROPOSAL_POSITION_CONFLICT");
  };
  const find = (rows: Rows, where: Filter) => { const row = rows.find(entry => matches(entry, where)); return row ? clone(row) : null; };
  const update = (rows: Rows, where: Filter, data: Record<string, unknown>) => {
    const row = rows.find(entry => matches(entry, where));
    if (!row) throw Error("ROW_MISSING");
    const next = { ...row, ...defined(data) };
    if (rows === state.products) uniqueNumber(next);
    if (rows === state.items) validItemPosition(next);
    Object.assign(row, defined(data)); state.writes.push(`${rows === state.products ? "product" : "row"}:${row.id}`);
    return clone(row);
  };
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => {
      const sql = query.join("?"); state.sql.push(sql);
      if (sql.includes('FROM "Product" WHERE "projectId"') && sql.includes("FOR UPDATE")) {
        const callback = beforeProductLock; beforeProductLock = undefined; callback?.();
      }
      return sql.includes('"WarehouseAccountingState"') ? [{ phase: state.warehousePhase }] : [];
    },
    client: {
      findUnique: async ({ where }: { where: Filter }) => find(state.clients, where),
      updateMany: async ({ where, data }: Write) => {
        const rows = state.clients.filter(row => matches(row, where));
        rows.forEach(row => update(state.clients, { id: row.id }, data)); return { count: rows.length };
      },
    },
    project: {
      aggregate: async () => ({ _max: { numberInt: Math.max(0, ...state.projects.map(row => Number(row.numberInt))) } }),
      create: async ({ data }: Write) => {
        if (typeof data.id !== "string") throw Error("PROJECT_ID_REQUIRED");
        if (state.projects.some(row => row.id === data.id || row.number === data.number)) throw Error("PROJECT_NUMBER_CONFLICT");
        const row: FixtureRow = { id: data.id, deletedAt: null, deletedById: null, stage: "LEAD", stageChangedAt: new Date(0), address: null,
          managerId: null, createdAt: new Date(0), updatedAt: new Date(0), ...defined(data) };
        state.projects.push(row); state.writes.push(`project:${row.id}`);
        const history = data.stageHistory as { create: Record<string, unknown> };
        state.stageHistory.push({ id: sequence("stage"), projectId: row.id, ...history.create });
        return clone(row);
      },
      findUnique: async ({ where }: { where: Filter }) => find(state.projects, where),
      update: async ({ where, data }: Write) => update(state.projects, where!, data),
    },
    product: {
      findMany: async ({ where }: { where: Filter }) => clone(state.products.filter(row => matches(row, where))),
      findUnique: async ({ where }: { where: Filter }) => find(state.products, where),
      create: async ({ data }: Write) => {
        const row = { id: sequence("product"), deletedAt: null, deletedById: null, engineerId: null,
          expectedPrice: null, initialPrice: null, kind: null, description: null, createdAt: new Date(0), updatedAt: new Date(0), ...defined(data) };
        uniqueNumber(row); state.products.push(row); state.writes.push(`product:${row.id}`);
        const history = data.statusHistory as { create: Record<string, unknown> };
        state.statusHistory.push({ id: sequence("status"), productId: row.id, ...history.create });
        return clone(row);
      },
      update: async ({ where, data }: Write) => update(state.products, where!, data),
      updateMany: async ({ where, data }: Write) => {
        const rows = state.products.filter(row => matches(row, where));
        rows.forEach(row => update(state.products, { id: row.id }, data)); return { count: rows.length };
      },
    },
    commercialProposal: {
      create: async ({ data }: Write) => {
        const row = { id: sequence("proposal"), deletedAt: null, isArchive: false, revision: 0,
          currency: "BYN", rate: null, rateDate: null, rateSource: null, ...data };
        state.proposals.push(row); state.writes.push(`proposal:${row.id}`); return clone(row);
      },
      findUnique: async ({ where }: { where: Filter }) => find(state.proposals, where),
      updateMany: async ({ where, data }: Write) => {
        if (state.forceCasFailure) return { count: 0 };
        const rows = state.proposals.filter(row => matches(row, where));
        rows.forEach(row => update(state.proposals, { id: row.id }, data)); return { count: rows.length };
      },
    },
    proposalItem: {
      findMany: async ({ where }: { where: Filter }) => clone(state.items.filter(row => matches(row, where))),
      count: async ({ where }: { where: Filter }) => state.items.filter(row => matches(row, where)).length,
      create: async ({ data }: Write) => {
        if (typeof data.id !== "string") throw Error("ITEM_ID_REQUIRED");
        const row: FixtureRow = { id: data.id, deletedAt: null, ...data };
        validItemPosition(row);
        if (state.items.some(other => other.id === row.id || other.productId === row.productId)) throw Error("ITEM_BINDING_CONFLICT");
        state.items.push(row); state.writes.push(`item:${row.id}`); return clone(row);
      },
      update: async ({ where, data }: Write) => update(state.items, where!, data),
    },
    changeLog: {
      findUnique: async ({ where }: { where: Filter }) => find(state.logs, where),
      create: async ({ data }: Write) => {
        const row = { id: sequence("audit"), ...data };
        if (state.logs.some(other => other.id === row.id)) throw Error("RECEIPT_CONFLICT");
        state.logs.push(row); return clone(row);
      },
    },
    domainEvent: { create: async ({ data }: Write) => {
      if (state.failEventType === data.type) throw Error("OUTBOX_FAILED");
      const row = { id: sequence("event"), ...data }; state.events.push(row); return clone(row);
    } },
    orgSetting: { findUnique: async () => null },
    productStatusHistory: { create: async ({ data }: Write) => {
      const row = { id: sequence("history"), ...data }; state.statusHistory.push(row); return clone(row);
    } },
    work: {
      findMany: async ({ where }: { where: Filter }) => clone(state.works.filter(row => matches(row, where))),
      update: async ({ where, data }: Write) => update(state.works, where!, data),
    },
    projectMaterial: {
      findMany: async ({ where }: { where: Filter }) => clone(state.materials.filter(row => matches(row, where))),
      update: async ({ where, data }: Write) => update(state.materials, where!, data),
    },
  } as unknown as Prisma.TransactionClient;
  let tail = Promise.resolve();
  const transaction: MutationTransaction = async operation => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = clone(state);
    try { return await operation(tx); }
    catch (error) { Object.assign(state, before); throw error; }
    finally { release(); }
  };
  return { state, tx, transaction, cloneState: () => clone(state), beforeProductLock: (run: () => void) => { beforeProductLock = run; },
    hooks: { environment: { PERO_KP_TEMP_CLIENT_ID: "temporary" },
      applyPricing: async () => { state.pricingCalls++; return { changed: false }; } },
  };
}
