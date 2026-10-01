import type { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import type { TaskTransaction } from "../../src/server/tasks/transaction";
import { matches, type FixtureRow as Row } from "./visibility-fixture";

export function taskShareFixture(productStatus: "DESIGN" | "PRODUCTION" = "PRODUCTION") {
  const now = new Date("2026-09-28T00:00:00.000Z");
  let state = {
    tasks: ["source", "predecessor", "dependent"].map((id): Row => ({
      id, projectId: "project", productId: "product", workId: id === "source" ? "work" : null,
      title: id, type: "Производство", status: id === "source" ? "IN_PROGRESS" : id === "predecessor" ? "DONE" : "NEW",
      assigneeId: "worker", quantity: id === "source" ? "10" : null, executorShare: "1",
      estimateMinutes: 100, dueAt: now, requiresPhoto: true, createdById: "manager",
      allocationGroupId: null, shareUnits: null, shareAmount: null, splitRevision: 0,
      createdAt: now, updatedAt: now, doneAt: null, doneById: null,
    })),
    users: [["worker", "WORKER"], ["recipient", "WORKER"], ["manager", "MANAGER"], ["engineer", "ENGINEER"], ["accountant", "ACCOUNTANT"], ["admin", "ADMIN"], ["director", "DIRECTOR"], ["mounter", "MOUNTER"]].map(([id, role]): Row => ({ id, name: id, roles: [role], active: true, payScheme: "PIECE" })),
    products: [{ id: "product", projectId: "project", number: "1.1", engineerId: "engineer", status: productStatus }] as Row[],
    pools: [{ id: "pool", productId: "product", kind: "ENGINEERING", state: "DRAFT", revision: 0 }] as Row[],
    works: [{ id: "work", projectId: "project", productId: "product", title: "work", quantity: "10", priceSnapshot: "100", total: "1000", paymentKind: "LEGACY" }] as Row[],
    groups: [] as Row[], entries: [] as Row[], logs: [] as Row[], events: [] as Row[],
    dependencies: [{ taskId: "source", dependsOnId: "predecessor" }, { taskId: "dependent", dependsOnId: "source" }] as Row[],
    times: [{ id: "timer", taskId: "source", userId: "worker", minutes: 20, stoppedAt: null, startedAt: now }] as Row[],
    files: [{ id: "photo", taskId: "source", projectId: "project", productId: "product" }] as Row[],
    sequence: 0, currency: "BYN",
  };
  let failAt: string | null = null;
  const transactionContext = new AsyncLocalStorage<boolean>();
  const writes: string[] = [];
  const write = (name: string) => { writes.push(name); if (failAt === name) throw new Error("Injected transactional failure"); };
  const filtered = (rows: Row[], where?: Row) => rows.filter((row) => matches(row, where));
  function hydrate(row: Row): Row {
    return {
      ...row,
      project: { id: "project", number: "1" },
      product: state.products.find((product) => product.id === row.productId) ?? null,
      assignee: state.users.find((user) => user.id === row.assigneeId) ?? null,
      work: (() => { const work = state.works.find((item) => item.id === row.workId); const pool = state.pools.find((item) => item.id === work?.stagePayPoolId); return work ? { ...work, stagePayPool: work.stagePayPool ?? (pool ? { ...pool, product: state.products.find((item) => item.id === pool.productId) } : null) } : null; })(),
      allocationGroup: state.groups.find((group) => group.id === row.allocationGroupId) ?? null,
      _count: { payrollEntries: state.entries.filter((entry) => entry.taskId === row.id).length },
      dependencies: state.dependencies.filter((edge) => edge.taskId === row.id).map((edge) => ({ ...edge, dependsOn: state.tasks.find((task) => task.id === edge.dependsOnId) })),
      dependents: state.dependencies.filter((edge) => edge.dependsOnId === row.id),
      files: state.files.filter((file) => file.taskId === row.id),
    };
  }
  function updateRow(row: Row, data: Row) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
    }
    row.updatedAt = now;
    return hydrate(row);
  }
  const tx = {
    $queryRaw: async () => [{ locked: 1 }],
    $executeRaw: async () => 0,
    task: {
      findFirst: async ({ where }: { where?: Row }) => filtered(state.tasks.map(hydrate), where)[0] ?? null,
      findUnique: async ({ where }: { where?: Row }) => filtered(state.tasks.map(hydrate), where)[0] ?? null,
      findMany: async ({ where }: { where?: Row } = {}) => filtered(state.tasks.map(hydrate), where),
      count: async ({ where }: { where?: Row }) => filtered(state.tasks, where).length,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        write("task.update"); const row = filtered(state.tasks, where)[0]; if (!row) throw new Error("Task not found"); return updateRow(row, data);
      },
      create: async ({ data }: { data: Row }) => {
        write("task.create"); const row: Row = { id: `child-${++state.sequence}`, createdAt: now, updatedAt: now, doneAt: null, doneById: null, executorShare: "1", allocationGroupId: null, shareUnits: null, shareAmount: null, splitRevision: 0, ...data };
        state.tasks.push(row);
        const dependencies = data.dependencies as { create?: Row[] } | undefined;
        for (const edge of dependencies?.create ?? []) state.dependencies.push({ taskId: row.id, dependsOnId: edge.dependsOnId });
        return hydrate(row);
      },
      delete: async ({ where }: { where: Row }) => { write("task.delete"); const row = filtered(state.tasks, where)[0]; state.tasks = state.tasks.filter((task) => task !== row); return row; },
    },
    taskAllocationGroup: {
      create: async ({ data }: { data: Row }) => { write("group.create"); const row = { id: `group-${++state.sequence}`, createdAt: now, ...data }; state.groups.push(row); return row; },
    },
    user: {
      findUnique: async ({ where }: { where: Row }) => filtered(state.users, where)[0] ?? null,
      findFirst: async ({ where }: { where: Row }) => filtered(state.users, where)[0] ?? null,
      findMany: async ({ where }: { where?: Row } = {}) => filtered(state.users, where),
    },
    work: {
      findUnique: async ({ where }: { where: Row }) => { const row = filtered(state.works, where)[0]; return row ? { ...row, tasks: state.tasks.filter((task) => task.workId === row.id) } : null; },
      delete: async ({ where }: { where: Row }) => { write("work.delete"); const row = filtered(state.works, where)[0]; state.works = state.works.filter((work) => work !== row); return row; },
    },
    project: { findUnique: async () => ({ id: "project", number: "1" }) },
    product: { findFirst: async ({ where }: { where: Row }) => filtered(state.products, where)[0] ?? null,
      findUnique: async ({ where }: { where: Row }) => filtered(state.products, where)[0] ?? null },
    productStagePayPool: {
      findUnique: async ({ where }: { where: Row }) => filtered(state.pools, where)[0] ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        write("pool.update"); const row = filtered(state.pools, where)[0]; if (!row) throw new Error("Pool not found"); return updateRow(row, data);
      },
    },
    orgSetting: { findUnique: async () => ({ value: state.currency }) },
    file: { updateMany: async ({ where, data }: { where: Row; data: Row }) => { write("file.updateMany"); const rows = filtered(state.files, where); for (const row of rows) Object.assign(row, data); return { count: rows.length }; } },
    timeEntry: {
      findFirst: async ({ where }: { where: Row }) => filtered(state.times, where)[0] ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => { write("time.updateMany"); const rows = filtered(state.times, where); for (const row of rows) Object.assign(row, data); return { count: rows.length }; },
      aggregate: async ({ where }: { where: Row }) => ({ _sum: { minutes: filtered(state.times, where).reduce((sum, row) => sum + Number(row.minutes ?? 0), 0) } }),
      groupBy: async ({ where }: { where: Row }) => {
        const sums = new Map<string, number>(); for (const row of filtered(state.times, where)) sums.set(String(row.taskId), (sums.get(String(row.taskId)) ?? 0) + Number(row.minutes));
        return [...sums].map(([taskId, minutes]) => ({ taskId, _sum: { minutes } }));
      },
      create: async ({ data }: { data: Row }) => { write("time.create"); const row = { id: `time-${++state.sequence}`, startedAt: now, minutes: 0, stoppedAt: null, ...data }; state.times.push(row); return row; },
      deleteMany: async ({ where }: { where: Row }) => { write("time.deleteMany"); state.times = state.times.filter((row) => !matches(row, where)); return { count: 0 }; },
    },
    payrollEntry: {
      count: async ({ where }: { where: Row }) => filtered(state.entries, where).length,
      findFirst: async ({ where }: { where: Row }) => filtered(state.entries, where)[0] ?? null,
      create: async ({ data }: { data: Row }) => { write("payroll.create"); const row = { id: `pay-${++state.sequence}`, ...data }; state.entries.push(row); return row; },
    },
    taskDependency: {
      findMany: async ({ where }: { where?: Row }) => filtered(state.dependencies, where),
      deleteMany: async ({ where }: { where: Row }) => { write("dependencies.delete"); state.dependencies = state.dependencies.filter((edge) => !matches(edge, where)); return { count: 0 }; },
      createMany: async ({ data }: { data: Row[] }) => {
        write("dependencies.create"); for (const edge of data) if (!state.dependencies.some((old) => old.taskId === edge.taskId && old.dependsOnId === edge.dependsOnId)) state.dependencies.push(edge);
        return { count: data.length };
      },
    },
    changeLog: {
      findUnique: async ({ where }: { where: Row }) => filtered(state.logs, where)[0] ?? null,
      create: async ({ data }: { data: Row }) => { write("log.create"); state.logs.push(data); return data; },
    },
    domainEvent: { create: async ({ data }: { data: Row }) => { write("event.create"); const row = { id: `event-${++state.sequence}`, ...data }; state.events.push(row); return row; } },
  };
  let tail = Promise.resolve();
  const transaction: TaskTransaction = async (operation) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = structuredClone(state);
    try { return await transactionContext.run(true, () => operation(tx as unknown as Prisma.TransactionClient)); }
    catch (error) { state = before; throw error; }
    finally { release(); }
  };
  return { state: () => state, writes, transaction, inTransaction: () => transactionContext.getStore() ?? false, database: { ...tx, $transaction: transaction }, failOn: (operation: string) => { failAt = operation; } };
}
