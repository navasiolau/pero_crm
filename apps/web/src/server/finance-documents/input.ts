import { array, uuid } from "zod";

export const reportDocumentIdsSchema = array(uuid({ error: "Некорректный идентификатор документа" })
  .transform(value => value.toLowerCase()))
  .refine(ids => new Set(ids).size === ids.length, "Документ указан несколько раз");

export type ReportDocumentInput = { reportDocumentId?: string; reportDocumentIds?: string[] };
export const exclusiveReportDocumentInput = (data: ReportDocumentInput) =>
  data.reportDocumentId === undefined || data.reportDocumentIds === undefined;
export const exclusiveReportDocumentError = {
  message: "Укажите один документ или список документов, не оба поля одновременно", path: ["reportDocumentIds"],
};
export function inputReportDocumentIds(data: ReportDocumentInput): string[] {
  return data.reportDocumentIds ?? (data.reportDocumentId ? [data.reportDocumentId] : []);
}

/** Подтверждение нового формата требует всех связей и совместимого первого файла. */
export function reportDocumentSetMatches(payment: {reportDocumentId: string | null;
  reportDocuments: {documentId: string; position: number}[]}, ids: readonly string[]) {
  return payment.reportDocumentId === (ids[0] ?? null) && payment.reportDocuments.length === ids.length &&
    payment.reportDocuments.every((row, index) => row.position === index && row.documentId === ids[index]);
}
