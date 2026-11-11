import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FurnitureSection } from "@pero/kp-template";
import { z } from "zod";
import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";

export type ProposalJsonObject = { [key: string]: Prisma.JsonValue };
export type ProposalItemState = ProposalJsonObject & { id: string; qty: number; specifications?: FurnitureSection[] };
export type ProposalState = ProposalJsonObject & { items: ProposalItemState[] };

const itemId = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Некорректный ID позиции");
const sectionSchema = z.object({
  id: z.string(),
  type: z.enum([...FurnitureSpecifications.CATALOG.map(section => section.type), "custom"] as const),
  group: z.enum(FurnitureSpecifications.GROUPS.map(group => group.id)),
  label: z.string(),
  value: z.string(),
}).strict();
const specificationSnapshot = (sections: unknown) => FurnitureSpecifications.normalize({ ...FurnitureSpecifications.empty(), sections });
const specificationsSchema = z.array(sectionSchema).refine(sections => specificationSnapshot(sections) !== null,
  "Проверьте названия, группы и уникальные ID разделов характеристик");
export const proposalStateSchema = z.object({
  items: z.array(z.object({
    id: itemId.optional(),
    qty: z.number().int("Количество должно быть целым").min(1).max(2_147_483_647).default(1),
    specifications: specificationsSchema.optional(),
  }).catchall(z.json())),
}).catchall(z.json()).superRefine((state, context) => {
  const ids = new Set<string>();
  state.items.forEach((item, position) => {
    if (!item.id) return;
    if (ids.has(item.id)) context.addIssue({ code: "custom", path: ["items", position, "id"], message: "ID позиции повторяется" });
    ids.add(item.id);
  });
});

export const proposalClientSnapshotSchema = z.object({
  name: z.string().trim().min(1), lastName: z.string().nullable(), middleName: z.string().nullable(),
  phone: z.string().trim().min(1), email: z.string().nullable(), address: z.string().nullable(),
  comment: z.string().nullable(), passportNumber: z.string().nullable(), passportIssuedBy: z.string().nullable(),
}).partial().strict();
export type ProposalClientSnapshotInput = z.infer<typeof proposalClientSnapshotSchema>;
const writeFields = {
  operationId: z.uuid(),
  clientId: z.string().min(1).optional(),
  clientSnapshot: proposalClientSnapshotSchema.optional(),
  address: z.string().nullable().optional(),
  state: proposalStateSchema,
};
export const createProposalSchema = z.object(writeFields).strict();
export const saveProposalSchema = z.object({
  ...writeFields,
  proposalId: z.string().min(1),
  expectedRevision: z.number().int().min(0),
}).strict();
export type CreateProposalInput = z.input<typeof createProposalSchema>;
export type SaveProposalInput = z.input<typeof saveProposalSchema>;

export type ProposalFailureKind = "validation" | "forbidden" | "not-found" | "conflict" | "editor-outdated" | "locked" | "failure";
export class ProposalWriteError extends Error {
  constructor(readonly kind: ProposalFailureKind, message: string) { super(message); }
}

export type ProposalWriteResult = {
  ok: true;
  proposalId: string;
  projectId: string;
  number: string;
  revision: number;
  state: ProposalState;
  items: { id: string; productId: string; number: string }[];
  noOp: boolean;
  repeated?: boolean;
};

/** Отсутствующие ID назначаются один раз перед сохранением исходного JSON. */
export function normalizeProposalState(input: unknown, makeId: () => string = randomUUID): ProposalState {
  const parsed = proposalStateSchema.safeParse(input);
  if (!parsed.success) throw new ProposalWriteError("validation", parsed.error.issues[0]?.message ?? "Некорректное состояние КП");
  const used = new Set(parsed.data.items.map(item => item.id).filter((id): id is string => Boolean(id)));
  const items = parsed.data.items.map(item => {
    let id = item.id;
    if (!id) {
      id = makeId();
      if (!itemId.safeParse(id).success || used.has(id)) throw new ProposalWriteError("validation", "Не удалось назначить уникальный ID позиции");
      used.add(id);
    }
    return { ...item, id };
  });
  return { ...parsed.data, items } as ProposalState;
}

/** Переход выполняется только при записи. Отсутствующий список и явная очистка различаются. */
export function canonicalizeProposalSpecifications(state: ProposalState): ProposalState {
  return { ...state, items: state.items.map(item => {
    const sections = item.specifications ?? FurnitureSpecifications.fromLegacy(item).sections;
    return { ...item, specifications: FurnitureSpecifications.orderedSections(sections) };
  }) };
}

/** Разделы КП и самостоятельные поля позиции образуют технический снимок изделия. */
export function proposalItemTechnicalSpecifications(item: ProposalItemState) {
  if (item.specifications === undefined) return FurnitureSpecifications.fromLegacy(item);
  const { description, size, note } = item;
  return { ...FurnitureSpecifications.fromLegacy({ description, size, note }), sections: item.specifications };
}

/** Полная запись может удалить позицию, но не переключить оставшуюся позицию на устаревшие поля. */
export function assertCurrentProposalEditor(current: Prisma.JsonValue, next: ProposalState): void {
  const previous = proposalObject(current);
  if (!Array.isArray(previous.items)) return;
  const byId = new Map(previous.items.map(raw => {
    const item = proposalObject(raw);
    return [item.id, item] as const;
  }));
  for (const item of next.items) {
    const saved = byId.get(item.id);
    if (!saved || !Array.isArray(saved.specifications)) continue;
    if (!Array.isArray(item.specifications) ||
      canonicalProposalJson({ products: saved.products }) !== canonicalProposalJson({ products: item.products }))
      throw new ProposalWriteError("editor-outdated", "Формат характеристик КП изменился — обновите редактор и повторите изменения");
  }
}

/** Порядок JSON-ключей не меняет содержание повторяемой операции. */
export function canonicalProposalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalProposalJson).join(",")}]`;
  return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalProposalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function proposalOperationIdentity(actorId: string, operationId: string, input: unknown, pricingFingerprint?: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  return {
    receiptId: `kp:mutation:${digest(`${actorId}\0${operationId}`)}`,
    fingerprint: digest(canonicalProposalJson({ input, pricingFingerprint })),
  };
}

export function proposalObject(value: Prisma.JsonValue | undefined): ProposalJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ProposalJsonObject : {};
}

export function proposalText(value: Prisma.JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** Один Product на позицию; подблоки остаются характеристиками в описании. */
export function proposalItemDescription(item: ProposalItemState): string | null {
  const lines = [proposalText(item.description)];
  const size = proposalText(item.size);
  if (size.trim()) lines.push(`Размеры: ${size}`);
  const labels = { outer: "Каркас", inner: "Фасад", hinges: "Петли / механизмы", drawers: "Ящики / наполнение", lighting: "Подсветка" };
  if (Array.isArray(item.products)) for (const raw of item.products) {
    const block = proposalObject(raw);
    const title = proposalText(block.title);
    const details = Object.entries(labels).map(([field, label]) => {
      const text = proposalText(block[field]);
      return text.trim() ? `${label}: ${text}` : "";
    }).filter(Boolean);
    if (title.trim()) lines.push(title);
    lines.push(...details);
  }
  const note = proposalText(item.note);
  if (note.trim()) lines.push(`Примечание: ${note}`);
  return lines.filter(line => line.trim()).join("\n\n") || null;
}
