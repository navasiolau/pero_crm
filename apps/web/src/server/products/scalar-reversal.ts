import type { Prisma } from "@prisma/client";
import { cardFieldRevision, fieldCommand } from "@/server/changelog/field-reversal";


export const PRODUCT_CARD_FIELDS = ["title", "kind", "description", "engineerId", "quantity", "expectedPrice"] as const;
export type ProductCardField = typeof PRODUCT_CARD_FIELDS[number];
export type ProductCardRow = {
  title: string; titleRevision: number; kind: string | null; description: string | null; engineerId: string | null;
  quantity: number; expectedPrice: Prisma.Decimal | string | number | null; fieldRevisions: Prisma.JsonValue;
};
export const productFieldKind = (field: ProductCardField) => `product.${field}`;

export function productFieldState(field: ProductCardField, row: ProductCardRow) {
  const revision = field === "title" ? row.titleRevision : cardFieldRevision(row.fieldRevisions, field);
  const value = field === "expectedPrice" ? row.expectedPrice?.toString() ?? null : row[field];
  return { value, revision };
}

export function productFieldCommand(field: ProductCardField, before: ProductCardRow, after: ProductCardRow) {
  return fieldCommand(productFieldKind(field), productFieldState(field, before), productFieldState(field, after), field === "title" ? 1 : 2);
}
