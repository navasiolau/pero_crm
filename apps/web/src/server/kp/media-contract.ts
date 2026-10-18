import { createHash } from "node:crypto";
import { z } from "zod";

export const KP_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const KP_IMAGE_MAX_PIXELS = 40_000_000;
export const KP_IMAGE_MAX_SIDE = 1600;
export const KP_MEDIA_TOKEN_PREFIX = "kp-media:";
export const KP_MEDIA_LEASE_MS = 5 * 60_000;
export const KP_MEDIA_ORPHAN_DELAY_MS = 24 * 60 * 60_000;

const messages = {
  KP_MEDIA_INVALID: "Некорректное изображение КП.",
  KP_MEDIA_TOO_LARGE: "Изображение больше 15 МиБ.",
  KP_MEDIA_BUSY: "Подготовка изображений занята. Повторите запрос.",
  KP_MEDIA_REFERENCE_INVALID: "Нужна приватная ссылка на изображение этого КП.",
  KP_MEDIA_NOT_FOUND: "Изображение КП недоступно.",
  KP_MEDIA_EXPIRED: "Срок хранения изображения КП истёк. Можно убрать ссылку и выпустить КП без изображения.",
  KP_MEDIA_FORBIDDEN: "Недостаточно прав для изображений КП.",
  KP_MEDIA_LOCKED: "Изображения можно менять только в проекте «Лид».",
  KP_MEDIA_REVISION_CONFLICT: "КП изменилось. Обновите редактор.",
  KP_MEDIA_OPERATION_CONFLICT: "Идентификатор операции уже используется другим запросом.",
  KP_MEDIA_LEASE_LOST: "Загрузка больше не принадлежит этому запросу. Повторите операцию.",
  KP_MEDIA_STORAGE_CHANGED: "Не совпадает целевое приватное хранилище КП.",
  KP_MEDIA_STORAGE_FAILED: "Не удалось подтвердить сохранение изображения.",
  KP_MEDIA_CHECKSUM_MISMATCH: "Содержимое изображения не совпало с записанным снимком.",
  KP_MEDIA_COPY_REQUIRED: "Не подготовлены отдельные копии изображений изделия.",
} as const;

export class ProposalMediaError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "ProposalMediaError";
  }
}

const component = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const itemId = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const mediaIdSchema = component;
export const mediaOperationSchema = z.object({
  actorId: component, proposalId: component, expectedRevision: z.number().int().min(0), operationId: z.uuid(),
}).strict();
export type MediaOperation = z.infer<typeof mediaOperationSchema>;
export type MediaMime = "image/jpeg" | "image/png" | "image/webp";
export type MediaBinding = { endpoint: string; bucket: string; region?: string };
export type MediaObject = { key: string; sha256: string; size: number; mimeType: MediaMime };
export type PreparedImage = { original: Buffer; optimized: Buffer; originalMimeType: MediaMime;
  optimizedMimeType: MediaMime; originalHash: string; optimizedHash: string; width: number; height: number; fileName: string };
export type MediaOwner = { proposalId: string; projectId: string; revision: number; createdAt: Date };

const mime = z.enum(["image/jpeg", "image/png", "image/webp"]);
const objectSchema = z.object({ key: z.string().min(1).max(1024), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(KP_IMAGE_MAX_BYTES), mimeType: mime }).strict();
const bindingSchema = z.object({
  endpoint: z.string().url(), bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  region: z.string().min(1).max(255).optional(),
}).strict();

export const mediaPlanSchema = z.object({
  schema: z.literal(1), kind: z.enum(["UPLOAD_MEDIA", "COPY_PRODUCT_MEDIA"]),
  jobId: z.uuid(), cleanupJobId: z.uuid(), mediaId: component, proposalId: component, projectId: component,
  actorId: component, expectedRevision: z.number().int().min(0), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  binding: bindingSchema, original: objectSchema.optional(), optimized: objectSchema,
  source: objectSchema.optional(),
  fileName: z.string().min(1).max(255), width: z.number().int().positive(), height: z.number().int().positive(),
  expiresAt: z.iso.datetime(), itemId: itemId.optional(), fileId: z.uuid().optional(), storedName: z.string().optional(),
}).strict();
export type MediaPlan = z.infer<typeof mediaPlanSchema>;
export type MediaReservation = { plan: MediaPlan; leaseOwner: string; repeated: boolean; ready: boolean };
export type PreparedProductMedia = { proposalId: string; expectedRevision: number; jobs: readonly string[] };
export type MediaReferenceScope = { kind: "uploaded" } | { kind: "current" } | { kind: "version"; versionId: string };
export type MediaReadRequest = { actorId: string; proposalId: string; mediaId: string;
  variant: "original" | "optimized"; scope: MediaReferenceScope };
export type ReadableMedia = { binding: MediaBinding; object: MediaObject; fileName: string };

export function mediaSha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function mediaFingerprint(input: Record<string, string | number>): string {
  return mediaSha256(Buffer.from(JSON.stringify(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))));
}
export function mediaToken(mediaId: string): string {
  if (!mediaIdSchema.safeParse(mediaId).success) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  return KP_MEDIA_TOKEN_PREFIX + mediaId;
}
export function mediaIdFromToken(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.startsWith(KP_MEDIA_TOKEN_PREFIX)) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  const id = value.slice(KP_MEDIA_TOKEN_PREFIX.length);
  if (!mediaIdSchema.safeParse(id).success) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  return id;
}
export function itemMediaReferences(items: readonly { id: string; image?: unknown; image2?: unknown }[]) {
  const seen = new Set<string>();
  return items.map(item => {
    if (!itemId.safeParse(item.id).success || seen.has(item.id)) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
    seen.add(item.id);
    return { itemId: item.id, mediaIds: [...new Set([mediaIdFromToken(item.image), mediaIdFromToken(item.image2)]
      .filter((id): id is string => id !== null))] };
  });
}

export function imageMimeFromBytes(bytes: Uint8Array): MediaMime {
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "image/jpeg";
  if (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (input.length >= 12 && input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new ProposalMediaError("KP_MEDIA_INVALID");
}
export function parseMediaBinding(value: unknown): MediaBinding {
  const parsed = bindingSchema.safeParse(value);
  if (!parsed.success) throw new ProposalMediaError("KP_MEDIA_STORAGE_CHANGED");
  const endpoint = new URL(parsed.data.endpoint);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    /[\\\s]/.test(parsed.data.endpoint) || parsed.data.region && /[\s\u0000-\u001f]/.test(parsed.data.region))
    throw new ProposalMediaError("KP_MEDIA_STORAGE_CHANGED");
  return { ...parsed.data, endpoint: endpoint.toString() };
}
export function sameMediaBinding(left: MediaBinding, right: MediaBinding): boolean {
  const a = parseMediaBinding(left), b = parseMediaBinding(right);
  return a.endpoint === b.endpoint && a.bucket === b.bucket && (a.region ?? "us-east-1") === (b.region ?? "us-east-1");
}
const extension = (type: MediaMime) => type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
export function mediaObjectKeys(proposalId: string, mediaId: string, originalType: MediaMime, optimizedType: MediaMime) {
  if (![proposalId, mediaId].every(value => component.safeParse(value).success)) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  return { original: `kp/proposals/${proposalId}/original/${mediaId}.${extension(originalType)}`,
    optimized: `kp/proposals/${proposalId}/optimized/${mediaId}.${extension(optimizedType)}` };
}
export function productMediaStoredName(jobId: string, type: MediaMime): string {
  if (!z.uuid().safeParse(jobId).success) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  return `kp-${jobId}.${extension(type)}`;
}
export function validateMediaPlan(input: unknown): MediaPlan {
  const parsed = mediaPlanSchema.safeParse(input);
  if (!parsed.success) throw new ProposalMediaError("KP_MEDIA_INVALID");
  const plan = parsed.data;
  parseMediaBinding(plan.binding);
  if (plan.kind === "UPLOAD_MEDIA") {
    if (!plan.original || plan.source || plan.itemId || plan.fileId || plan.storedName) throw new ProposalMediaError("KP_MEDIA_INVALID");
    const keys = mediaObjectKeys(plan.proposalId, plan.mediaId, plan.original.mimeType, plan.optimized.mimeType);
    if (plan.original.key !== keys.original || plan.optimized.key !== keys.optimized) throw new ProposalMediaError("KP_MEDIA_INVALID");
  } else {
    if (plan.original || !plan.source || !plan.itemId || !plan.fileId || plan.storedName !== productMediaStoredName(plan.jobId, plan.optimized.mimeType) ||
      plan.optimized.key !== `${plan.projectId}/${plan.storedName}` || plan.source.key !==
      mediaObjectKeys(plan.proposalId, plan.mediaId, plan.source.mimeType, plan.source.mimeType).optimized ||
      plan.source.sha256 !== plan.optimized.sha256 || plan.source.size !== plan.optimized.size || plan.source.mimeType !== plan.optimized.mimeType)
      throw new ProposalMediaError("KP_MEDIA_INVALID");
  }
  return plan;
}

/** Год считается от исходной даты КП; 29 февраля в невисокосном году становится 28 февраля. */
export function proposalMediaExpiry(createdAt: Date): Date {
  const result = new Date(createdAt);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result;
}
