import { randomUUID } from "node:crypto";
import { crm, CrmError } from "./crm";
import { tg, type TgMessage } from "./tg";
import { documentFromMessage, TelegramDocumentError, type TelegramDocument } from "./telegram-documents";

export type ReportDocument = { id: string; fileName: string; mimeType: string };
export type DocumentAttempt = { key: string; clientMutationId: string; attachment: TelegramDocument };
type ReportDraft = { reportDocument?: ReportDocument; reportDocuments?: ReportDocument[]; documentAttempt?: DocumentAttempt };

/** Старый диалог сохранял attempt даже после READY; это не незавершённая загрузка. */
export function hasUnresolvedDocumentAttempt(draft: ReportDraft) {
  return !!draft.documentAttempt && (draft.reportDocuments !== undefined || !draft.reportDocument);
}
export function paymentReportDocumentInput(draft: ReportDraft) {
  return draft.reportDocuments !== undefined ? {reportDocumentIds: draft.reportDocuments.map(file => file.id)}
    : draft.reportDocument ? {reportDocumentId: draft.reportDocument.id} : {};
}

/** Повтор той же отправки сохраняет UUID, в том числе после потери ответа CRM. */
export function documentAttempt(message: TgMessage, previous?: DocumentAttempt): DocumentAttempt | undefined {
  const attachment = documentFromMessage(message);
  if (!attachment) return;
  const key = JSON.stringify([attachment.uniqueId, attachment.fileName, attachment.mimeType]);
  return previous?.key === key ? { ...previous, attachment } : { key, clientMutationId: randomUUID(), attachment };
}

export async function uploadFinanceDocument(actorId: string, attempt: DocumentAttempt): Promise<ReportDocument> {
  const bytes = await tg.downloadDocument(attempt.attachment);
  const result = await crm.uploadFinanceDocument(actorId, { clientMutationId: attempt.clientMutationId,
    fileName: attempt.attachment.fileName, mimeType: attempt.attachment.mimeType, bytes });
  if (!result.ok || !result.document) throw new CrmError(result.error ?? "CRM не подтвердила документ");
  return result.document;
}

export function documentUploadError(error: unknown) {
  return error instanceof CrmError || error instanceof TelegramDocumentError ? error.message : "Не удалось загрузить документ";
}
