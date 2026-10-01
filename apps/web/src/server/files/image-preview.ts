import { createHash } from "node:crypto";

import sharp from "sharp";

import { isCoverImageMime } from "@/lib/product-cover";

export type ImagePreviewVariant = "card" | "cover";
export type PreviewFile = {
  id: string;
  projectId: string;
  productId: string | null;
  storedName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
};

const SOURCE_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_CACHE_BYTES = 25 * 1024 * 1024;
const MAX_PENDING_JOBS = 24;
const SIZE: Record<ImagePreviewVariant, { width: number; height: number }> = {
  card: { width: 480, height: 480 },
  cover: { width: 1280, height: 1600 },
};

type Asset = { bytes: Buffer; etag: string };
type Rendered = { kind: "asset"; asset: Asset } | { kind: "missing" } | { kind: "invalid" };

/** A released slot transfers directly to the oldest waiter, with no gap. */
export function createPreviewLimiter(maxConcurrent = 2, maxPending = MAX_PENDING_JOBS) {
  const capacity = Math.max(1, Math.floor(maxConcurrent));
  const waiters: Array<() => void> = [];
  let active = 0;

  async function acquire(): Promise<() => void> {
    if (active < capacity) active++;
    else {
      if (waiters.length >= maxPending) throw new Error("PREVIEW_BUSY");
      await new Promise<void>((resolve) => waiters.push(resolve));
      // The releasing task transferred its occupied slot to this waiter.
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiters.shift();
      if (next) next();
      else active--;
    };
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    const release = await acquire();
    try { return await work(); }
    finally { release(); }
  }

  return { acquire, run };
}

export type ImagePreviewDependencies<Actor> = {
  lookup: (actor: Actor, fileId: string) => Promise<PreviewFile | null>;
  loadOriginal: (file: PreviewFile, maxBytes: number) => Promise<Buffer | null>;
};

export function createImagePreviewService<Actor>(
  deps: ImagePreviewDependencies<Actor>,
  options: { maxCacheBytes?: number; maxConcurrent?: number } = {},
) {
  const maxCacheBytes = options.maxCacheBytes ?? DEFAULT_CACHE_BYTES;
  const maxConcurrent = options.maxConcurrent ?? 2;
  const cache = new Map<string, Asset>();
  const inFlight = new Map<string, Promise<Rendered>>();
  const limiter = createPreviewLimiter(maxConcurrent);
  let cachedBytes = 0;

  function remember(key: string, asset: Asset) {
    if (maxCacheBytes <= 0 || asset.bytes.length > maxCacheBytes) return;
    while (cachedBytes + asset.bytes.length > maxCacheBytes) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cachedBytes -= cache.get(oldest)!.bytes.length;
      cache.delete(oldest);
    }
    cache.set(key, asset);
    cachedBytes += asset.bytes.length;
  }

  async function render(file: PreviewFile, variant: ImagePreviewVariant): Promise<Rendered> {
    const key = [file.id, file.projectId, file.productId, file.storedName, file.mimeType,
      file.size, file.createdAt.getTime(), variant].join(":");
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return { kind: "asset", asset: cached };
    }
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = limiter.run(async (): Promise<Rendered> => {
      const original = await deps.loadOriginal(file, SOURCE_MAX_BYTES);
      if (!original) return { kind: "missing" };
      if (original.length > SOURCE_MAX_BYTES) return { kind: "invalid" };
      try {
        const bytes = await sharp(original, { limitInputPixels: 64_000_000, failOn: "error" })
          .rotate()
          .resize(SIZE[variant].width, SIZE[variant].height,
            { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78, effort: 4 })
          .toBuffer();
        const etag = `"preview-${createHash("sha256").update(bytes).digest("hex")}"`;
        const asset = { bytes, etag };
        remember(key, asset);
        return { kind: "asset", asset };
      } catch { return { kind: "invalid" }; }
    }).catch((): Rendered => ({ kind: "invalid" })).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  }

  async function respond(input: { actor: Actor; fileId: string; variant: ImagePreviewVariant;
    ifNoneMatch?: string | null }): Promise<Response> {
    // This lookup is deliberately outside cache and singleflight on every request.
    const file = await deps.lookup(input.actor, input.fileId);
    if (!file) return errorResponse(404, "Файл не найден");
    if (!isCoverImageMime(file.mimeType)) return errorResponse(415, "Нужно изображение");
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > SOURCE_MAX_BYTES)
      return errorResponse(413, "Изображение больше 25 МБ");
    const result = await render(file, input.variant);
    if (result.kind === "missing") return errorResponse(404, "Файл не найден в хранилище");
    if (result.kind === "invalid") return errorResponse(422, "Не удалось создать превью");
    const { bytes, etag } = result.asset;
    const headers = new Headers({
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Vary": "Cookie",
      "ETag": etag,
      "Content-Type": "image/webp",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    });
    const conditions = input.ifNoneMatch?.split(",").map((item) => item.trim()) ?? [];
    if (conditions.includes(etag) || conditions.includes(`W/${etag}`) || conditions.includes("*"))
      return new Response(null, { status: 304, headers });
    headers.set("Content-Length", String(bytes.length));
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  }

  return { respond };
}

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: {
    "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff",
  } });
}
