import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { stabilizeProductNumberLinks } from "./numbering";

const compositionRow = z.object({ id: z.string().min(1), number: z.string(), suffixInt: z.number().int().nullable(), updatedAt: z.string().datetime() }).strict();
export const productNumberRepairBaselineSchema = z.object({
  version: z.literal(1), operationId: z.uuid(), projectId: z.string().min(1), projectNumber: z.string().regex(/^[1-9]\d*$/),
  productId: z.string().min(1), expectedUpdatedAt: z.string().datetime(), protectedHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedSuffixes: z.array(z.number().int().positive().max(2_147_483_647)).length(15),
  composition: z.array(compositionRow).length(15),
}).strict();
export type ProductNumberRepairBaseline = z.infer<typeof productNumberRepairBaselineSchema>;
export type ProductNumberRepairResult = { productId: string; projectId: string; from: string; to: string; updatedAt: string; repeated: boolean };
function requireRepair(valid: unknown, code: string): asserts valid { if (!valid) throw Error(`PRODUCT_NUMBER_REPAIR_${code}`); }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value) ?? "undefined";
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function lock(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId" = ${projectId} ORDER BY id FOR UPDATE`;
}
async function composition(tx: Prisma.TransactionClient, projectId: string) {
  const rows = await tx.product.findMany({ where: { projectId, deletedAt: null },
    select: { id: true, number: true, suffixInt: true, updatedAt: true }, orderBy: { id: "asc" } });
  return rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}
/** Все прямые производственные/финансовые связи сравниваются без вывода содержимого. */
async function protectedHash(tx: Prisma.TransactionClient, productId: string) {
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, include: {
    statusHistory: true, tasks: true, works: true, files: true, projectMaterials: true, stockMovements: true,
    stagePayPools: true, stageSettlements: true, payrollEntries: true, percentageConfigs: true,
    percentageCompletions: true, logisticsShipmentLines: true, proposalItem: true,
  } });
  const { number, suffixInt, updatedAt, ...protectedValues } = product;
  void number; void suffixInt; void updatedAt;
  const serialized: Record<string, unknown> = JSON.parse(JSON.stringify(protectedValues));
  // Порядок relation-коллекций не задан SQL; содержательные JSON-массивы сохраняют порядок.
  for (const value of Object.values(serialized)) if (Array.isArray(value)) value.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
  return hash(serialized);
}

/** Только чтение и locks; проверка не создаёт receipt или иных записей. */
export async function checkProductNumberRepairInTransaction(tx: Prisma.TransactionClient,
  input: { projectNumber: string; operationId: string; expectedSuffixes?: readonly number[] }): Promise<ProductNumberRepairBaseline> {
  requireRepair(/^[1-9]\d*$/.test(input.projectNumber) && z.uuid().safeParse(input.operationId).success, "INPUT");
  const expectedSuffixes = input.expectedSuffixes ? [...input.expectedSuffixes] : [...Array.from({ length: 14 }, (_, i) => i + 1), 64];
  requireRepair(expectedSuffixes.length === 15 && new Set(expectedSuffixes).size === 15 && expectedSuffixes.includes(64) && !expectedSuffixes.includes(15)
    && expectedSuffixes.every(value => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647), "EXPECTED_COMPOSITION");
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
  const project = await tx.project.findUnique({ where: { number: input.projectNumber }, select: { id: true, number: true, deletedAt: true } });
  requireRepair(project && project.deletedAt === null, "PROJECT");
  await lock(tx, project.id);
  const rows = await composition(tx, project.id);
  const oldNumber = `${project.number}.64`, newNumber = `${project.number}.15`;
  requireRepair(rows.length === 15, "COMPOSITION_COUNT");
  for (const suffix of expectedSuffixes) requireRepair(rows.some(row => row.number === `${project.number}.${suffix}` && row.suffixInt === suffix), "COMPOSITION");
  const product = rows.find(row => row.number === oldNumber && row.suffixInt === 64);
  requireRepair(product, "SOURCE");
  requireRepair(!await tx.product.findFirst({ where: { number: newNumber, deletedAt: null }, select: { id: true } }), "DESTINATION_OCCUPIED");
  return { version: 1, operationId: input.operationId, projectId: project.id, projectNumber: project.number, productId: product.id,
    expectedUpdatedAt: product.updatedAt, protectedHash: await protectedHash(tx, product.id), expectedSuffixes, composition: rows };
}

type RepairReceipt = { fingerprint: string; baseline: ProductNumberRepairBaseline; result: ProductNumberRepairResult;
  after: z.infer<typeof compositionRow>[]; protectedHash: string };
function readReceipt(value: Prisma.JsonValue | null): RepairReceipt {
  requireRepair(value && typeof value === "object" && !Array.isArray(value), "RECEIPT");
  requireRepair(typeof value.fingerprint === "string" && value.result && value.after && typeof value.protectedHash === "string", "RECEIPT");
  return value as unknown as RepairReceipt;
}
async function verifyAfter(tx: Prisma.TransactionClient, receipt: RepairReceipt) {
  requireRepair(canonical(await composition(tx, receipt.baseline.projectId)) === canonical(receipt.after), "POST_STATE_CHANGED");
  requireRepair(await protectedHash(tx, receipt.baseline.productId) === receipt.protectedHash, "PROTECTED_DATA_CHANGED");
}

export async function applyProductNumberRepairInTransaction(tx: Prisma.TransactionClient, input: unknown): Promise<ProductNumberRepairResult> {
  const baseline = productNumberRepairBaselineSchema.parse(input), fingerprint = hash(baseline);
  await lock(tx, baseline.projectId);
  const receiptId = `product-number-repair:${baseline.operationId}`;
  const existing = await tx.changeLog.findUnique({ where: { id: receiptId } });
  if (existing) {
    requireRepair(existing.entity === "product" && existing.entityId === baseline.productId && existing.action === "number.repair", "RECEIPT_OWNER");
    const saved = readReceipt(existing.newValue); requireRepair(saved.fingerprint === fingerprint, "RECEIPT_PAYLOAD");
    requireRepair(!await tx.changeLog.findUnique({ where: { id: `product-number-repair-rollback:${baseline.operationId}` } }), "ALREADY_ROLLED_BACK");
    await verifyAfter(tx, saved); return { ...saved.result, repeated: true };
  }
  const current = await checkProductNumberRepairInTransaction(tx, baseline);
  requireRepair(canonical(current) === canonical(baseline), "STALE_BASELINE");
  const from = `${baseline.projectNumber}.64`, to = `${baseline.projectNumber}.15`;
  await stabilizeProductNumberLinks(tx, [{ id: baseline.productId, number: from }]);
  const changed = await tx.product.updateMany({ where: { id: baseline.productId, projectId: baseline.projectId, deletedAt: null,
    number: from, suffixInt: 64, updatedAt: new Date(baseline.expectedUpdatedAt) }, data: { number: to, suffixInt: 15 } });
  requireRepair(changed.count === 1, "CAS");
  const after = await composition(tx, baseline.projectId), product = after.find(row => row.id === baseline.productId);
  requireRepair(product && product.number === to && product.suffixInt === 15, "POST_NUMBER");
  requireRepair(canonical(after.filter(row => row.id !== baseline.productId)) === canonical(baseline.composition.filter(row => row.id !== baseline.productId)), "OTHER_PRODUCTS_CHANGED");
  requireRepair(await protectedHash(tx, baseline.productId) === baseline.protectedHash, "PROTECTED_DATA_CHANGED");
  const result: ProductNumberRepairResult = { productId: baseline.productId, projectId: baseline.projectId, from, to, updatedAt: product.updatedAt, repeated: false };
  await tx.changeLog.create({ data: { id: receiptId, actorType: "system", actorId: "maintenance:product-numbering-211", actorName: "Исправление нумерации №211", source: "maintenance",
    entity: "product", entityId: baseline.productId, action: "number.repair", field: "number",
    oldValue: { number: from, suffixInt: 64, updatedAt: baseline.expectedUpdatedAt },
    newValue: json({ fingerprint, baseline, result, after, protectedHash: baseline.protectedHash }) } });
  return result;
}

export async function rollbackProductNumberRepairInTransaction(tx: Prisma.TransactionClient, input: unknown): Promise<ProductNumberRepairResult> {
  const baseline = productNumberRepairBaselineSchema.parse(input), fingerprint = hash(baseline);
  await lock(tx, baseline.projectId);
  const existing = await tx.changeLog.findUnique({ where: { id: `product-number-repair:${baseline.operationId}` } });
  requireRepair(existing && existing.entity === "product" && existing.entityId === baseline.productId && existing.action === "number.repair", "RECEIPT_OWNER");
  const saved = readReceipt(existing.newValue); requireRepair(saved.fingerprint === fingerprint, "RECEIPT_PAYLOAD");
  const receiptId = `product-number-repair-rollback:${baseline.operationId}`;
  const repeated = await tx.changeLog.findUnique({ where: { id: receiptId } });
  if (repeated) {
    const receipt = readReceipt(repeated.newValue); requireRepair(receipt.fingerprint === fingerprint, "RECEIPT_PAYLOAD");
    await verifyAfter(tx, receipt); return { ...receipt.result, repeated: true };
  }
  await verifyAfter(tx, saved);
  requireRepair(!await tx.product.findFirst({ where: { number: saved.result.from, deletedAt: null }, select: { id: true } }), "ROLLBACK_DESTINATION_OCCUPIED");
  const changed = await tx.product.updateMany({ where: { id: baseline.productId, projectId: baseline.projectId, deletedAt: null,
    number: saved.result.to, suffixInt: 15, updatedAt: new Date(saved.result.updatedAt) }, data: { number: saved.result.from, suffixInt: 64 } });
  requireRepair(changed.count === 1, "ROLLBACK_CAS");
  const after = await composition(tx, baseline.projectId), product = after.find(row => row.id === baseline.productId);
  requireRepair(product && product.number === saved.result.from && product.suffixInt === 64, "ROLLBACK_POST_NUMBER");
  requireRepair(await protectedHash(tx, baseline.productId) === baseline.protectedHash, "PROTECTED_DATA_CHANGED");
  const result: ProductNumberRepairResult = { productId: baseline.productId, projectId: baseline.projectId, from: saved.result.to,
    to: saved.result.from, updatedAt: product.updatedAt, repeated: false };
  await tx.changeLog.create({ data: { id: receiptId, actorType: "system", actorId: "maintenance:product-numbering-211", actorName: "Обратная коррекция №211", source: "maintenance",
    entity: "product", entityId: baseline.productId, action: "number.repair.rollback", field: "number",
    oldValue: { number: saved.result.to, suffixInt: 15, updatedAt: saved.result.updatedAt },
    newValue: json({ fingerprint, baseline, result, after, protectedHash: baseline.protectedHash }) } });
  return result;
}
