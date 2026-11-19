import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { lockFileStorageBinding } from "./storage-binding-fence";

const fileReversalState = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  productId: z.string().nullable(),
  taskId: z.string().nullable(),
  storedName: z.string().min(1),
  expectedDeletedAt: z.iso.datetime().nullable(),
  deleted: z.boolean(),
}).strict();

export const retainedFileReversalSchema = z.object({
  files: z.array(fileReversalState).max(2),
  pointer: z.object({
    kind: z.enum(["project", "product"]),
    id: z.string().min(1),
    expectedFileId: z.string().nullable(),
    fileId: z.string().nullable(),
  }).strict().optional(),
}).strict();
export type RetainedFileReversal = z.infer<typeof retainedFileReversalSchema>;

export function retainedFileReversalState(
  file: Omit<z.infer<typeof fileReversalState>, "deleted" | "expectedDeletedAt">,
  current: Date | null,
  deleted: boolean,
): z.infer<typeof fileReversalState> {
  return { id: file.id, projectId: file.projectId, productId: file.productId, taskId: file.taskId,
    storedName: file.storedName, expectedDeletedAt: current?.toISOString() ?? null, deleted };
}

export async function checkRetainedFileReversal(
  tx: Prisma.TransactionClient,
  data: RetainedFileReversal,
): Promise<string | null> {
  if (data.pointer) {
    const { kind, id, expectedFileId, fileId } = data.pointer;
    const row = kind === "project"
      ? await tx.project.findFirst({ where: { id, deletedAt: null }, select: { coverFileId: true } })
      : await tx.product.findFirst({ where: { id, deletedAt: null, project: { deletedAt: null } }, select: { sketchFileId: true } });
    if (!row || ("coverFileId" in row ? row.coverFileId : row.sketchFileId) !== expectedFileId)
      return "Обложка или эскиз уже изменены";
    if (fileId && !data.files.some(file => file.id === fileId && !file.deleted)) {
      const destination = await tx.file.findFirst({ where: {
        id: fileId, deletedAt: null,
        ...(kind === "project" ? { projectId: id, productId: null, taskId: null } : { productId: id }),
      }, select: { id: true } });
      if (!destination) return "Обложка или эскиз больше недоступны";
    }
  }
  for (const file of data.files) {
    const current = await tx.file.findFirst({ where: {
      id: file.id, projectId: file.projectId, productId: file.productId, taskId: file.taskId,
      storedName: file.storedName, deletedAt: file.expectedDeletedAt ? new Date(file.expectedDeletedAt) : null,
      project: { deletedAt: null }, OR: [{ productId: null }, { product: { deletedAt: null } }],
    }, select: { id: true, coverForProject: { select: { id: true } }, sketchForProduct: { select: { id: true } } } });
    if (!current) return "Файл или его привязка изменились";
    if (file.deleted && (
      current.coverForProject && (data.pointer?.kind !== "project" || data.pointer.id !== current.coverForProject.id)
      || current.sketchForProduct && (data.pointer?.kind !== "product" || data.pointer.id !== current.sketchForProduct.id)
    )) return "Файл уже используется как обложка или эскиз";
  }
  return null;
}

export async function applyRetainedFileReversal(
  tx: Prisma.TransactionClient,
  actorId: string,
  data: RetainedFileReversal,
): Promise<RetainedFileReversal> {
  const projectIds = new Set(data.files.map(file => file.projectId));
  const productIds = new Set(data.files.flatMap(file => file.productId ? [file.productId] : []));
  if (data.pointer?.kind === "project") projectIds.add(data.pointer.id);
  if (data.pointer?.kind === "product") productIds.add(data.pointer.id);
  for (const id of [...projectIds].sort())
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${id} FOR UPDATE`;
  for (const id of [...productIds].sort())
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${id} FOR UPDATE`;
  for (const file of [...data.files].sort((a, b) => a.id.localeCompare(b.id))) {
    await tx.$queryRaw`SELECT id FROM "File" WHERE id=${file.id} FOR UPDATE`;
    await lockFileStorageBinding(tx, file.projectId, file.storedName);
  }
  const conflict = await checkRetainedFileReversal(tx, data);
  if (conflict) throw new Error(conflict);
  const now = new Date();
  for (const file of data.files) {
    await tx.file.update({ where: { id: file.id }, data: {
      deletedAt: file.deleted ? now : null, deletedById: file.deleted ? actorId : null,
    } });
  }
  if (data.pointer?.kind === "project")
    await tx.project.update({ where: { id: data.pointer.id, AND: [{ coverFileId: data.pointer.expectedFileId }] }, data: { coverFileId: data.pointer.fileId } });
  if (data.pointer?.kind === "product")
    await tx.product.update({ where: { id: data.pointer.id, AND: [{ sketchFileId: data.pointer.expectedFileId }] }, data: { sketchFileId: data.pointer.fileId } });
  return {
    files: data.files.map(file => retainedFileReversalState(file, file.deleted ? now : null, file.expectedDeletedAt !== null)),
    pointer: data.pointer && { ...data.pointer, fileId: data.pointer.expectedFileId, expectedFileId: data.pointer.fileId },
  };
}

