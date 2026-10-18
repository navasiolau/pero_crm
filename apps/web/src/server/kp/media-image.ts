import sharp from "sharp";
import { createPreviewLimiter } from "@/server/files/image-preview";
import { KP_IMAGE_MAX_BYTES, KP_IMAGE_MAX_PIXELS, KP_IMAGE_MAX_SIDE, ProposalMediaError,
  imageMimeFromBytes, mediaSha256, type MediaMime, type PreparedImage } from "./media-contract";

async function inspect(bytes: Buffer, declaredMime?: string) {
  if (!bytes.length) throw new ProposalMediaError("KP_MEDIA_INVALID");
  if (bytes.length > KP_IMAGE_MAX_BYTES) throw new ProposalMediaError("KP_MEDIA_TOO_LARGE");
  const mimeType = imageMimeFromBytes(bytes);
  if (declaredMime && mimeType !== declaredMime) throw new ProposalMediaError("KP_MEDIA_INVALID");
  const image = sharp(bytes, { limitInputPixels: KP_IMAGE_MAX_PIXELS, failOn: "warning", animated: false });
  try {
    const info = await image.metadata();
    if (!info.width || !info.height || (info.pages ?? 1) !== 1 || info.width * info.height > KP_IMAGE_MAX_PIXELS ||
      !["jpeg", "png", "webp"].includes(info.format ?? "")) throw new ProposalMediaError("KP_MEDIA_INVALID");
    // metadata не декодирует все пиксели: усечённые и повреждённые файлы также отклоняются.
    await image.clone().raw().toBuffer();
    return { mimeType, width: info.width, height: info.height, image };
  } catch (error) {
    if (error instanceof ProposalMediaError) throw error;
    throw new ProposalMediaError("KP_MEDIA_INVALID");
  }
}

const preparation = createPreviewLimiter(2, 8);
type ImageInput = {
  original: Buffer; fileName: string; mimeType?: string; optimized?: Buffer; optimizedMimeType?: string;
};
/** Оригинал и готовый browser/import optimized сохраняются побайтно без перекодирования. */
export async function prepareProposalImage(input: ImageInput): Promise<PreparedImage> {
  try { return await preparation.run(() => prepareImage(input)); }
  catch (error) {
    if (error instanceof ProposalMediaError) throw error;
    if (error instanceof Error && error.message === "PREVIEW_BUSY") throw new ProposalMediaError("KP_MEDIA_BUSY");
    throw new ProposalMediaError("KP_MEDIA_INVALID");
  }
}
async function prepareImage(input: ImageInput): Promise<PreparedImage> {
  const original = Buffer.from(input.original), source = await inspect(original, input.mimeType);
  let optimized: Buffer, optimizedMimeType: MediaMime, width: number, height: number;
  if (input.optimized !== undefined) {
    optimized = Buffer.from(input.optimized);
    const ready = await inspect(optimized, input.optimizedMimeType);
    ({ mimeType: optimizedMimeType, width, height } = ready);
  } else {
    try {
      const result = await source.image.rotate().resize({ width: KP_IMAGE_MAX_SIDE, height: KP_IMAGE_MAX_SIDE,
        fit: "inside", withoutEnlargement: true }).flatten({ background: "#000000" }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
      optimized = result.data; optimizedMimeType = "image/jpeg"; width = result.info.width; height = result.info.height;
    } catch { throw new ProposalMediaError("KP_MEDIA_INVALID"); }
  }
  if (optimized.length > KP_IMAGE_MAX_BYTES) throw new ProposalMediaError("KP_MEDIA_TOO_LARGE");
  const cleanName = input.fileName.toWellFormed().replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
  let fileName = "";
  for (const character of cleanName) {
    if (fileName.length + character.length > 255) break;
    fileName += character;
  }
  fileName ||= "image";
  return { original, optimized, originalMimeType: source.mimeType, optimizedMimeType,
    originalHash: mediaSha256(original), optimizedHash: mediaSha256(optimized), width, height, fileName };
}
