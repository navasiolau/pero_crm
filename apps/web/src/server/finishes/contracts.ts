import { z } from "zod";
import type { CatalogueMediaAsset, Finish } from "@prisma/client";
export const FINISH_KIND_LABELS = { ENAMEL: "Эмаль", VENEER: "Шпон", COATING: "Покрытие" } as const;
const text = (max: number) => z.string().trim().min(1, "Заполните обязательное поле").max(max, `Не больше ${max} символов`);
export const finishFieldsSchema = z.object({ kind: z.enum(["ENAMEL", "VENEER", "COATING"]), name: text(160), code: text(80).transform(value => value.normalize("NFKC").toUpperCase()).pipe(z.string().max(80, "Не больше 80 символов")), color: text(120) }).strict();
export const finishUpdateSchema = finishFieldsSchema.extend({ id: z.uuid(), expectedRevision: z.number().int().min(0).max(2147483647) }).strict();
export const finishActiveSchema = z.object({ id: z.uuid(), active: z.boolean(), expectedRevision: z.number().int().min(0).max(2147483647) }).strict();
export type FinishFields = z.input<typeof finishFieldsSchema>;
export type FinishView = Pick<Finish, "id" | "kind" | "name" | "code" | "color" | "active" | "revision" | "sampleAssetId"> & { updatedAt: string; sampleAsset: Pick<CatalogueMediaAsset, "id"|"fileName"|"mimeType"|"size"> | null };
export function finishView(row: Finish & {sampleAsset?: Pick<CatalogueMediaAsset,"id"|"fileName"|"mimeType"|"size"|"deletedAt"> | null}): FinishView { return { id: row.id, kind: row.kind, name: row.name, code: row.code, color: row.color, active: row.active, revision: row.revision, sampleAssetId: row.sampleAssetId??null, sampleAsset:row.sampleAsset&&!row.sampleAsset.deletedAt?{id:row.sampleAsset.id,fileName:row.sampleAsset.fileName,mimeType:row.sampleAsset.mimeType,size:row.sampleAsset.size}:null, updatedAt: row.updatedAt.toISOString() }; }
export type FinishMutationResult = { ok: true; row: FinishView; noOp?: boolean } | { ok: false; kind: "validation" | "conflict" | "forbidden" | "not-found" | "failure"; error: string };
