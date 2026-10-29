import { z } from "zod";

const entityId = z.string().trim().min(1).max(128);
const mutationId = z.uuid().transform(value => value.toLowerCase());
const shipmentDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату отгрузки")
  .refine(value => { const date = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, "Укажите существующую дату");
const quantity = z.number().finite().positive("Количество должно быть больше нуля").max(999_999_999.999)
  .refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.0001, "Количество: не более трёх знаков после запятой");

export const logisticsShipmentLineSchema = z.discriminatedUnion("kind", [
  z.object({ projectId: entityId, kind: z.literal("PRODUCT"), productId: entityId,
    quantity: quantity.refine(Number.isInteger, "Количество изделий должно быть целым") }).strict(),
  z.object({ projectId: entityId, kind: z.literal("MATERIAL"), materialId: entityId, quantity }).strict(),
]);
export type LogisticsShipmentLineInput = z.output<typeof logisticsShipmentLineSchema>;

const manifestShape = {
  date: shipmentDate,
  comment: z.string().trim().max(5000).default(""),
  ttnNotRequired: z.boolean().optional(),
  shares: z.array(z.object({ projectId: entityId, percentBps: z.number().int().min(1).max(10000).optional() }).strict()).min(1),
  lines: z.array(logisticsShipmentLineSchema).min(1, "Добавьте состав отгрузки"),
};
const tripShape = { clientMutationId: mutationId, ...manifestShape };

function validateManifest(data: { shares: { projectId: string; percentBps?: number }[]; lines: LogisticsShipmentLineInput[] }, ctx: z.RefinementCtx) {
  const projects = new Set(data.shares.map(share => share.projectId));
  if (projects.size !== data.shares.length) ctx.addIssue({ code: "custom", path: ["shares"], message: "Проект не должен повторяться" });
  const total = data.shares.reduce((sum, share) => sum + (share.percentBps ?? (data.shares.length === 1 ? 10000 : 0)), 0);
  if (total !== 10000 || data.shares.some(share => share.percentBps === undefined && data.shares.length > 1))
    ctx.addIssue({ code: "custom", path: ["shares"], message: "Укажите положительные доли проектов с суммой 100%" });
  const used = new Set(data.lines.map(line => line.projectId));
  if (used.size !== projects.size || [...used].some(id => !projects.has(id)))
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Состав отгрузки должен соответствовать выбранным проектам" });
  const keys = data.lines.map(line => shipmentLineKey(line));
  if (new Set(keys).size !== keys.length)
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Позиция состава не должна повторяться в одном проекте" });
}

function withDefaultShare<T extends { shares: { projectId: string; percentBps?: number }[] }>(data: T):
  Omit<T, "shares"> & { shares: { projectId: string; percentBps: number }[] } {
  const { shares, ...values } = data;
  return { ...values, shares: shares.map(share => ({ projectId: share.projectId, percentBps: share.percentBps ?? 10000 })) };
}

export const logisticsTripCreateSchema = z.object({ ...tripShape, ttnNotRequired: z.boolean().default(false) })
  .strict().superRefine(validateManifest).transform(withDefaultShare);
export const logisticsTripUpdateSchema = z.object({ ...tripShape, tripId: z.uuid(), expectedRevision: z.number().int().min(1).max(2_147_483_646) })
  .strict().superRefine(validateManifest).transform(withDefaultShare);
export const logisticsTripManifestSchema = z.object(manifestShape).strict().superRefine(validateManifest).transform(withDefaultShare);
export type LogisticsTripCreateInput = z.output<typeof logisticsTripCreateSchema>;
export type LogisticsTripUpdateInput = z.output<typeof logisticsTripUpdateSchema>;
export type LogisticsTripManifestInput = z.output<typeof logisticsTripManifestSchema>;
export type LogisticsTripMutationResult = { tripId: string; revision: number; repeated: boolean };

export function shipmentLineKey(line: { projectId: string; kind: string; productId?: string | null; materialId?: string | null }) {
  return `${line.projectId}:${line.kind}:${line.kind === "PRODUCT" ? line.productId : line.materialId}`;
}

export const logisticsDocumentUploadSchema = z.object({
  tripId: z.uuid(), clientMutationId: mutationId,
  stage: z.enum(["ISSUED", "SIGNED"]),
  ttnNumber: z.string().trim().max(120).nullish().transform(value => value || null),
  fileName: z.string().trim().min(1).max(255).refine(value => !/[\x00-\x1f\x7f/\\]/.test(value), "Некорректное имя файла"),
  mimeType: z.string().max(127).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/, "Некорректный тип файла")
    .transform(value => value.toLowerCase()),
}).strict();

export type LogisticsDocumentView = {
  id: string; tripId: string; source: "logistics"; fileName: string; mimeType: string; size: number;
  stage: "ISSUED" | "SIGNED"; ttnNumber: string | null; createdAt: string;
};
export type LogisticsTripView = {
  mode: "manage"; id: string; date: string; comment: string; revision: number; ttnNotRequired: boolean;
  shares: { id: string; projectId: string; projectNumber: string; projectTitle: string; percentBps: number }[];
  lines: { id: string; projectId: string; kind: "PRODUCT" | "MATERIAL"; productId: string | null; materialId: string | null;
    nameSnapshot: string; numberSnapshot: string | null; unitSnapshot: string; quantity: number }[];
  documents: LogisticsDocumentView[];
};
export type LogisticsTripDocumentsView = {
  mode: "documents"; id: string; date: string; ttnNotRequired: boolean; projects: { id: string; number: string }[]; documents: LogisticsDocumentView[];
};

export const logisticsTripListSchema = z.object({
  query: z.string().trim().max(200).default(""), projectId: entityId.optional(),
  dateFrom: shipmentDate.optional(), dateTo: shipmentDate.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().refine(value => [10, 20, 50, 100].includes(value)).default(20),
  direction: z.enum(["asc", "desc"]).default("desc"),
}).refine(data => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, "Начальная дата должна быть не позже конечной");
export type LogisticsTripListInput = z.output<typeof logisticsTripListSchema>;
