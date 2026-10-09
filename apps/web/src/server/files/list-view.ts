import type {File, Prisma} from "@prisma/client";
import type {FileListItem} from "@/components/file-list";
import type {VisibilityActor} from "@/server/access/visibility";
import {mayDeleteStoredFile} from "./delete-permission";

export type OrdinaryFileForList = Pick<File, "id" | "fileName" | "mimeType" | "section" | "uploadedById" | "projectId" | "productId" | "taskId">;
export type OrdinaryFileListRow = FileListItem & Pick<File, "section">;

/** Контекст/автор нужны только для действующих прав; клиент получает имя и разрешённое действие. */
export async function ordinaryFileListView(db: Prisma.TransactionClient, actor: VisibilityActor | undefined, files: readonly OrdinaryFileForList[]): Promise<OrdinaryFileListRow[]> {
  return Promise.all(files.map(async file => ({
    id: file.id,
    fileName: file.fileName,
    mimeType: file.mimeType,
    section: file.section,
    canDelete: actor ? await mayDeleteStoredFile(db, actor, file) : false,
  })));
}