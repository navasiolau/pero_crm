import { apiFailure } from "./api-contract";

type ContractRenderLimits = { docxPages: number; docxSources: number; docxPngBytes: number; docxTotalPngBytes: number; stateBytes: number };
/** Production передаёт shared KP_RENDER_LIMITS №184; проверяется до base64. */
export function assertContractRenderBudget(limits: ContractRenderLimits, snapshots: { settings: unknown; summary: unknown; profile: unknown },
  sources: readonly { images: readonly Uint8Array[] }[]) {
  if (sources.length > limits.docxSources) return apiFailure("KP_CONTRACT_RENDER_LIMIT", 413, "Превышено допустимое количество приложений");
  let pages = 0, bytes = 0;
  for (const source of sources) {
    pages += source.images.length;
    if (pages > limits.docxPages) return apiFailure("KP_CONTRACT_RENDER_LIMIT", 413, `Превышен допустимый объём договора: ${limits.docxPages} страниц`);
    for (const image of source.images) {
      bytes += image.byteLength;
      if (image.byteLength > limits.docxPngBytes || bytes > limits.docxTotalPngBytes)
        return apiFailure("KP_CONTRACT_RENDER_LIMIT", 413, "Приложения договора превышают допустимый объём");
    }
  }
  if (Buffer.byteLength(JSON.stringify(snapshots)) > limits.stateBytes)
    return apiFailure("KP_CONTRACT_RENDER_LIMIT", 413, "Условия договора превышают допустимый объём");
}
