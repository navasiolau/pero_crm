import type { ProposalMediaAsset } from "@pero/kp-template";
import { apiFailure } from "./api-contract";
import type { ContractArtifact } from "./contract-ports";
import type { ArtifactRecord, LifecycleState } from "./lifecycle-contract";
import { itemMediaReferences, type MediaMime } from "./media-contract";
import type { PdfAsset } from "./render-worker";

export function lifecycleMediaIds(state: LifecycleState): string[] {
  const items = state.items.map(item => {
    if (typeof item.id !== "string" || !item.id.trim()) return apiFailure("KP_RENDER_SOURCE_INVALID", 410, "Не сохранён постоянный ID позиции КП");
    return { id: item.id, image: item.image, image2: item.image2 };
  });
  return [...new Set(itemMediaReferences(items).flatMap(item => item.mediaIds))];
}

export function contractArtifact(artifact: ArtifactRecord): ContractArtifact {
  if (artifact.kind !== "PDF" && artifact.kind !== "DOCX") return apiFailure("KP_ARTIFACT_INVALID", 410, "Формат документа недоступен");
  return { ...artifact, kind: artifact.kind };
}

/** Форматы совпадают с приватными изображениями №183; MIME не дополняется по умолчанию. */
export function isProposalMediaMime(value: string): value is MediaMime {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

export function proposalRenderAssets(assets: readonly PdfAsset[]): ProposalMediaAsset[] {
  return assets.map(asset => {
    if (!isProposalMediaMime(asset.mimeType)) return apiFailure("KP_RENDER_ASSET_INVALID", 410, "Формат сохранённого изображения недоступен");
    return { ...asset, mimeType: asset.mimeType };
  });
}
