/** A small relational fixture adapter: never opens a socket or writes a database. */
export type FixtureRow = Record<string, unknown>;
type Query = { where?: FixtureRow; select?: FixtureRow; include?: FixtureRow; skip?: number; take?: number; orderBy?: unknown; _sum?: FixtureRow };
const object = (value: unknown): value is FixtureRow => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

export function matches(row: FixtureRow | null, where: FixtureRow = {}): boolean {
  if (!row) return false;
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === "AND") return (Array.isArray(condition) ? condition : [condition]).every((part) => matches(row, part as FixtureRow));
    if (key === "OR") return (condition as FixtureRow[]).some((part) => matches(row, part));
    if (key === "NOT") return !matches(row, condition as FixtureRow);
    const value = row[key];
    if (!object(condition)) return value === condition;
    if ("in" in condition) return (condition.in as unknown[]).includes(value);
    if ("notIn" in condition) return !(condition.notIn as unknown[]).includes(value);
    if ("not" in condition) return value !== condition.not;
    if ("lt" in condition) return (value as string | number) < (condition.lt as string | number);
    if ("contains" in condition) {
      const text = String(value ?? "");
      return condition.mode === "insensitive"
        ? text.toLowerCase().includes(String(condition.contains).toLowerCase())
        : text.includes(String(condition.contains));
    }
    if ("hasSome" in condition) return (condition.hasSome as unknown[]).some((part) => (value as unknown[]).includes(part));
    if ("some" in condition) return (value as FixtureRow[]).some((part) => matches(part, condition.some as FixtureRow));
    return matches(value as FixtureRow | null, condition);
  });
}

function project(row: FixtureRow, query: Query): FixtureRow {
  const result: FixtureRow = query.select ? {} : Object.fromEntries(Object.entries(row).filter(([, value]) => !object(value) && !Array.isArray(value)));
  for (const [key, option] of Object.entries(query.select ?? query.include ?? {})) {
    if (key === "_count") {
      result[key] = Object.fromEntries(Object.entries((option as Query).select ?? {}).map(([relation, count]) => [relation,
        ((row[relation] ?? []) as FixtureRow[]).filter((item) => count === true || matches(item, (count as Query).where)).length,
      ]));
    } else if (option === true) result[key] = row[key];
    else if (object(option)) {
      const value = row[key];
      result[key] = Array.isArray(value)
        ? queryRows(value as FixtureRow[], option)
        : value && matches(value as FixtureRow, option.where as FixtureRow) ? project(value as FixtureRow, option) : null;
    }
  }
  return result;
}

export function queryRows(rows: FixtureRow[], query: Query = {}) {
  let result = rows.filter((row) => matches(row, query.where));
  const orders = Array.isArray(query.orderBy) ? query.orderBy : query.orderBy ? [query.orderBy] : [];
  const compare = (left: FixtureRow, right: FixtureRow, order: FixtureRow): number => {
    for (const [key, direction] of Object.entries(order)) {
      if (object(direction) && !("sort" in direction)) {
        const nested = compare(left[key] as FixtureRow, right[key] as FixtureRow, direction);
        if (nested) return nested;
      } else {
        const a = left[key] as string | number | null;
        const b = right[key] as string | number | null;
        if (a === b) continue;
        if (a === null) return 1;
        if (b === null) return -1;
        return (a < b ? -1 : 1) * ((object(direction) ? direction.sort : direction) === "desc" ? -1 : 1);
      }
    }
    return 0;
  };
  result = [...result].sort((a, b) => {
    for (const order of orders) {
      const difference = compare(a, b, order);
      if (difference) return difference;
    }
    return 0;
  });
  return result.slice(query.skip ?? 0, query.take === undefined ? undefined : (query.skip ?? 0) + query.take).map((row) => project(row, query));
}

export function fixtureModel(rows: FixtureRow[]) {
  return {
    findMany: async (query: Query = {}) => queryRows(rows, query),
    findFirst: async (query: Query = {}) => queryRows(rows, { ...query, take: 1 })[0] ?? null,
    count: async (query: Query = {}) => rows.filter((row) => matches(row, query.where)).length,
    groupBy: async () => [],
    aggregate: async (query: Query = {}) => ({ _sum: Object.fromEntries(Object.keys(query._sum ?? {}).map((field) => [
      field, rows.filter((row) => matches(row, query.where)).reduce((sum, row) => sum + Number(row[field] ?? 0), 0),
    ])) }),
  };
}

export function engineerFixture() {
  const engineer: FixtureRow = { id: "engineer", name: "Engineer", roles: ["ENGINEER"], active: true };
  const other: FixtureRow = { id: "other", name: "Other", roles: ["ENGINEER"], active: true };
  const client: FixtureRow = { id: "client", name: "Fixture", lastName: null, middleName: null, projects: [] };
  const projects: FixtureRow[] = ["mixed", "hidden", "field"].map((id, index) => ({
    id, number: id, numberInt: index, title: id, clientId: "client", client, manager: null,
    initialPrice: 999999, delivery: 111111, unloading: 222222, installation: 333333,
    products: [], tasks: [], works: [], files: [], payments: [], communications: [], stageHistory: [],
  }));
  client.projects = projects;
  const products: FixtureRow[] = [
    ["own", "mixed", "engineer", "DESIGN", 100],
    ["foreign", "mixed", "other", "DESIGN", 200],
    ["production", "mixed", "engineer", "PRODUCTION", 300],
    ["hidden-product", "hidden", "other", "DESIGN", 400],
    ["field-product", "field", "other", "PRODUCTION", 500],
  ].map(([id, projectId, engineerId, status, price]) => ({
    id, number: id, title: id, projectId, project: projects.find((p) => p.id === projectId),
    engineerId, engineer: engineerId === "engineer" ? engineer : other, status, expectedPrice: price,
    tasks: [], works: [], files: [], statusHistory: [], surveyor: null, sketchFile: null,
  }));
  const tasks = products.filter((p) => p.id !== "hidden-product").map((product): FixtureRow => ({
    id: `task-${product.id}`, title: product.id, product, productId: product.id, project: product.project,
    projectId: product.projectId, assigneeId: "engineer", assignee: engineer, status: "NEW",
    dependencies: [], files: [], work: null, workId: null, createdAt: new Date(0),
  }));
  tasks[0].dependencies = [{ dependsOn: tasks[1], dependsOnId: tasks[1].id }];
  const files: FixtureRow[] = ["own", "foreign", "production", "general", "cross-task"].map((name) => ({
    id: `file-${name}`, fileName: name, projectId: "mixed", project: projects[0],
    productId: products.find((p) => p.id === name)?.id ?? null,
    product: products.find((p) => p.id === name) ?? null,
    taskId: name === "cross-task" ? tasks[1].id : null,
    task: name === "cross-task" ? tasks[1] : null, createdAt: new Date(0),
  }));
  for (const project of projects) {
    project.products = products.filter((p) => p.projectId === project.id);
    project.tasks = tasks.filter((t) => t.projectId === project.id);
    project.files = files.filter((f) => f.projectId === project.id);
  }
  for (const product of products) {
    product.tasks = tasks.filter((t) => t.productId === product.id);
    product.files = files.filter((f) => f.productId === product.id);
  }
  return {
    products, projects, tasks, files,
    db: {
      product: fixtureModel(products), project: fixtureModel(projects), task: fixtureModel(tasks),
      file: fixtureModel(files), client: fixtureModel([client]), user: fixtureModel([engineer, other]),
      projectMaterial: fixtureModel([]), stockMovement: fixtureModel([]), timeEntry: fixtureModel([]),
      payrollEntry: fixtureModel([
        { id: "historical-earned", userId: "engineer", projectId: "hidden", month: "2000-01", amount: 500, scheme: "PERCENT_PROJECT", comment: "Historical earnings", createdAt: new Date(0) },
        { id: "someone-elses-earned", userId: "other", month: "2000-01", amount: 999, createdAt: new Date(0) },
      ]),
      payout: fixtureModel([{ id: "historical-paid", userId: "engineer", month: "2000-01", amount: 100, kind: "SALARY", comment: null, createdAt: new Date(0), createdById: null }]),
    },
  };
}
