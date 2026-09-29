import type { Prisma } from "@prisma/client";

/** Must run inside the common money/task advisory transaction after fresh file ACL. */
export async function deleteFileMetadataCore(tx: Prisma.TransactionClient, fileId: string) {
  const references = await tx.productCompositionFinish.count({ where: { sampleFileId: fileId } });
  if (references > 0) throw new Error("FILE_SAMPLE_IN_USE");
  return tx.file.delete({ where: { id: fileId } });
}
