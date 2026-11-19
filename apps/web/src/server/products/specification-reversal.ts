import { Prisma } from "@prisma/client";
import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import { z } from "zod";
import { cardFieldRevision, defineFieldReversal, fieldCommand } from "@/server/changelog/field-reversal";
import { JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { liveProductWhere } from "@/server/access/live-entities";
import { lockProductRow } from "./quantity-core";

const key = "technicalSpecifications";
const revisionKey = 'technicalSpecifications,description';
const kind = `product.${key}`;
type SpecificationRow = { technicalSpecifications: Prisma.JsonValue; fieldRevisions: Prisma.JsonValue };

function technicalState(row: SpecificationRow) {
  const normalized = FurnitureSpecifications.normalizeProduct(row.technicalSpecifications);
  if (!normalized && row.technicalSpecifications !== null) return null;
  if (!normalized) return { value: null, revision: cardFieldRevision(row.fieldRevisions, revisionKey) };
  const { sourceGeneration: _source, editRevision: _edit, ...value } = normalized;
  return { value, revision: cardFieldRevision(row.fieldRevisions, revisionKey) };
}

export function technicalSpecificationsCommand(before: SpecificationRow, after: SpecificationRow) {
  const previous = technicalState(before), current = technicalState(after);
  return previous && current ? fieldCommand(kind, previous, current) : undefined;
}

export async function persistTechnicalSpecifications(tx: Prisma.TransactionClient, id: string,
  specification: Prisma.InputJsonObject | typeof Prisma.DbNull) {
  return tx.product.update({ where: { id }, data: { technicalSpecifications: specification } });
}

const specificationSchema = z.custom<Prisma.InputJsonObject>(value =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  FurnitureSpecifications.normalizeProduct({ ...value, sourceGeneration: 0 }) !== null).nullable();

export const productSpecificationReversal = defineFieldReversal({
  kind, entity: "product", field: key, value: specificationSchema, lock: lockProductRow,
  async read(tx, id) {
    const product = await tx.product.findFirst({ where: { id, ...liveProductWhere } });
    return product ? technicalState(product) : null;
  },
  async update({ tx, entityId }, _previous, value) {
    const product = await tx.product.findFirstOrThrow({ where: { id: entityId, ...liveProductWhere } });
    const current = FurnitureSpecifications.normalizeProduct(product.technicalSpecifications);
    const generation = Math.max(current?.sourceGeneration ?? 0, cardFieldRevision(product.fieldRevisions, revisionKey));
    const restored = await persistTechnicalSpecifications(tx, entityId, value === null ? Prisma.DbNull :
      { ...value, sourceGeneration: generation + 1, editRevision: 0 });
    const state = technicalState(restored);
    if (!state) throw new JournalReversalRefusal("Предыдущий формат характеристик больше не поддерживается");
    return { ...state, cachePaths: [`/products/${encodeURIComponent(product.number)}`, `/projects/${encodeURIComponent(product.projectId)}`] };
  },
});
