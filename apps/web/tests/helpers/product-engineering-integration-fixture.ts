import type { Prisma } from "@prisma/client";

type Row = Record<string, unknown> & { id: string };
type State = {
  product: Row; project: Row; pools: Row[]; works: Row[]; tasks: Row[]; groups: Row[]; users: Row[];
  times: Row[]; files: Row[]; dependencies: Row[];
  conversions: Row[]; settlements: Row[]; shares: Row[]; payroll: Row[]; history: Row[]; logs: Row[]; events: Row[];
  payrollCurrency: string; sequence: number;
};

export function engineeringIntegrationFixture() {
  const date = new Date("2026-09-28T00:00:00.000Z");
  let state: State = {
    product: { id: "product", projectId: "project", number: "P.1", status: "DESIGN", expectedPrice: "500.00", engineerId: "primary" },
    project: { id: "project", currency: "BYN" },
    pools: [{ id: "pool", productId: "product", kind: "ENGINEERING", state: "DRAFT", ratePercent: "5.00", revision: 0, legacyPayrollEntryIds: [] }],
    works: [], tasks: [], groups: [], times: [], files: [], dependencies: [],
    users: ["manager", "primary", "second"].map((id) => ({ id, name: id, active: true, roles: id === "manager" ? ["MANAGER"] : id === "primary" ? ["ENGINEER"] : [], payScheme: "PIECE" })),
    conversions: [], settlements: [], shares: [], payroll: [], history: [], logs: [], events: [], payrollCurrency: "BYN", sequence: 0,
  };
  let failAt: string | null = null;
  const writes: string[] = [];
  const fail = (at: string) => { writes.push(at); if (failAt === at) throw new Error(`Injected ${at}`); };
  const next = (prefix: string) => `${prefix}-${++state.sequence}`;
  const select = (rows: Row[], id: string) => rows.find((row) => row.id === id) ?? null;
  const update = (row: Row, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
    return row;
  };
  const hydratedPool = (pool: Row) => ({ ...pool, works: state.works.filter((work) => work.stagePayPoolId === pool.id).map((work) => ({ ...work,
    tasks: state.tasks.filter((task) => task.workId === work.id).map((task) => ({ ...task, assignee: select(state.users, String(task.assigneeId)),
      allocationGroup: select(state.groups, String(task.allocationGroupId)) })) })) });
  const hydratedProduct = () => ({ ...state.product, project: state.project, engineer: select(state.users, String(state.product.engineerId)),
    works: state.works.filter((work) => work.productId === state.product.id),
    stagePayPools: state.pools.filter((pool) => pool.productId === state.product.id && pool.kind === "ENGINEERING").map(hydratedPool) });
  const db = {
    product: {
      findUnique: async () => hydratedProduct(),
      update: async ({ data }: { data: Row }) => { fail("product.update"); return update(state.product, data); },
    },
    project: { findUnique: async () => state.project },
    orgSetting: { findUnique: async () => ({ value: state.payrollCurrency }) },
    productStagePayPool: {
      findUnique: async ({ where, include }: { where: { id?: string; productId_kind?: { productId: string; kind: string } }; include?: { works?: boolean; product?: boolean } }) => {
        const key = where.productId_kind;
        const pool = where.id ? select(state.pools, where.id) : state.pools.find((row) => row.productId === key?.productId && row.kind === key?.kind);
        return pool ? { ...pool, ...(include?.product ? { product: hydratedProduct() } : {}), ...(include?.works ? { works: hydratedPool(pool).works } : {}) } : null;
      },
      create: async ({ data, include }: { data: Row; include?: { works?: boolean } }) => { fail("pool.create"); const row = { revision: 0, ratePercent: null, legacyPayrollEntryIds: [], ...data, id: next("pool") }; state.pools.push(row); return { ...row, ...(include?.works ? { works: [] } : {}) }; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { fail("pool.update"); return update(select(state.pools, where.id)!, data); },
    },
    work: {
      findUnique: async ({ where }: { where: { id: string } }) => { const work = select(state.works, where.id); return work ? { ...work,
        tasks: state.tasks.filter((task) => task.workId === work.id).map((task) => ({ ...task, allocationGroup: select(state.groups, String(task.allocationGroupId)) })),
        allocationGroups: state.groups.filter((group) => group.workId === work.id) } : null; },
      create: async ({ data }: { data: Row }) => { fail("work.create"); const row = { createdAt: date, ...data, id: next("work") }; state.works.push(row); return row; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { fail("work.update"); return update(select(state.works, where.id)!, data); },
    },
    task: {
      create: async ({ data }: { data: Row }) => { fail("task.create"); const row = { createdAt: date, splitRevision: 0, ...data, id: next("task") }; state.tasks.push(row); return row; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { fail("task.update"); return update(select(state.tasks, where.id)!, data); },
    },
    taskAllocationGroup: { create: async ({ data }: { data: Row }) => { fail("group.create"); const row = { ...data, id: next("group") }; state.groups.push(row); return row; } },
    user: { findUnique: async ({ where }: { where: { id: string } }) => select(state.users, where.id) },
    payrollEntry: { count: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      if (!where) return state.payroll.length;
      if (where.productId) return state.payroll.filter((row) => row.productId === where.productId && row.scheme === where.scheme).length;
      const clauses = where.OR as { workId?: string | { in: string[] }; taskId?: { in: string[] } }[] | undefined;
      return clauses ? state.payroll.filter((row) => clauses.some((clause) => (typeof clause.workId === "string" && row.workId === clause.workId) ||
        (typeof clause.workId === "object" && clause.workId.in.includes(String(row.workId))) || clause.taskId?.in.includes(String(row.taskId)))).length : state.payroll.length;
    }, create: async ({ data }: { data: Row }) => { fail("payroll.create"); const row = { ...data, id: next("payroll") }; state.payroll.push(row); return row; } },
    workPaymentConversion: {
      findUnique: async ({ where }: { where: { requestId: string } }) => state.conversions.find((row) => row.requestId === where.requestId) ?? null,
      create: async ({ data }: { data: Row }) => { fail("conversion.create"); const row = { ...data, id: next("conversion") }; state.conversions.push(row); return row; },
    },
    productStageSettlement: {
      count: async () => state.settlements.length,
      create: async ({ data }: { data: Row }) => { fail("settlement.create"); const row = { ...data, id: next("settlement") }; state.settlements.push(row); return row; },
    },
    productStageSettlementShare: { create: async ({ data }: { data: Row }) => { fail("share.create"); const row = { ...data, id: next("share") }; state.shares.push(row); return row; } },
    productStatusHistory: { create: async ({ data }: { data: Row }) => { fail("history.create"); const row = { ...data, id: next("history") }; state.history.push(row); return row; } },
    changeLog: { findUnique: async ({ where }: { where: { id: string } }) => select(state.logs, where.id),
      create: async ({ data }: { data: Row }) => { fail("log.create"); const row = { ...data, id: data.id ?? next("log") }; state.logs.push(row); return row; } },
    domainEvent: { create: async ({ data }: { data: Row }) => { fail("event.create"); const row = { ...data, id: next("event") }; state.events.push(row); return row; } },
  };
  let tail = Promise.resolve();
  const transaction = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
    const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; }); await previous;
    const before = structuredClone(state);
    try { return await operation(db as unknown as Prisma.TransactionClient); }
    catch (error) { state = before; throw error; }
    finally { release(); }
  };
  return { state: () => state, db: db as unknown as Prisma.TransactionClient, transaction, writes, failAt: (value: string | null) => { failAt = value; } };
}
