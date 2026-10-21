import type { Prisma } from "@prisma/client";
import type { ArtifactRecord } from "./lifecycle-contract";

export function proposalPdfFileName(state: unknown, fallback = "КП.pdf"): string {
  const order = state && typeof state === "object" && "order" in state ? state.order : null;
  const number = order && typeof order === "object" && "number" in order ? order.number : null;
  if (typeof number !== "string" && typeof number !== "number") return fallback;
  const safeNumber = String(number).toWellFormed().trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").slice(0, 120).replace(/[. ]+$/g, "");
  return safeNumber ? `КП_${safeNumber}.pdf` : fallback;
}

/** Имя старого PDF выводится из его версии; сам артефакт и файл остаются неизменными. */
export async function proposalArtifactFileName(db: Pick<Prisma.TransactionClient, "proposalVersion">, artifact: Pick<ArtifactRecord, "id" | "proposalId" | "kind" | "fileName">): Promise<string> {
  if (artifact.kind !== "PDF" || !artifact.proposalId) return artifact.fileName;
  const version = await db.proposalVersion.findFirst({ where: { proposalId: artifact.proposalId, pdfArtifactId: artifact.id }, orderBy: { createdAt: "desc" }, select: { state: true } });
  return version ? proposalPdfFileName(version.state, artifact.fileName) : artifact.fileName;
}
