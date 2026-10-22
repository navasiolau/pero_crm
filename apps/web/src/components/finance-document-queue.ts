import { createRequestId } from "@/lib/request-id";
import { uploadSizeLimitError, uploadSizeLimitFor } from "@/server/files/upload-limits";
import type { FinanceDocumentView } from "@/server/finance-documents/contracts";

export type FinanceUploadRow = { file: File; clientMutationId: string;
  state: "QUEUED" | "UPLOADING" | "READY" | "UNKNOWN" | "ERROR"; progress: number;
  document?: FinanceDocumentView; error?: string };
export class FinanceUploadFailure extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}
type Upload = (row: FinanceUploadRow, progress: (value: number) => void) => Promise<FinanceDocumentView>;

/** Один транспортный запрос за раз; повтор отдельной строки не создаёт новый UUID. */
export function createFinanceDocumentQueue(upload: Upload, changed: (rows: FinanceUploadRow[]) => void,
  requestId: () => string = createRequestId) {
  let rows: FinanceUploadRow[] = [], running = false;
  const emit = () => changed(rows.map(row => ({ ...row })));
  async function pump() {
    if (running) return;
    running = true;
    try {
      for (let row = rows.find(item => item.state === "QUEUED"); row; row = rows.find(item => item.state === "QUEUED")) {
        row.state = "UPLOADING"; row.error = undefined; row.progress = 0; emit();
        const current = row;
        try {
          current.document = await upload(current, value => { current.progress = value; emit(); });
          current.state = "READY"; current.progress = 100;
        } catch (error) {
          current.state = error instanceof FinanceUploadFailure && !error.uncertain ? "ERROR" : "UNKNOWN";
          current.error = error instanceof Error ? error.message : "Не удалось подтвердить загрузку";
        }
        emit();
      }
    } finally { running = false; }
  }
  return {
    add(files: readonly File[]) {
      for (const file of files) {
        const limit = uploadSizeLimitFor({ mimeType: file.type });
        const error = file.size === 0 ? "Выберите непустой файл" : file.size > limit.maxBytes ? uploadSizeLimitError(limit.kind) : undefined;
        rows.push({ file, clientMutationId: requestId(), state: error ? "ERROR" : "QUEUED", progress: 0, error });
      }
      emit(); void pump();
    },
    retry(id: string) {
      const row = rows.find(item => item.clientMutationId === id);
      if (!row || !["ERROR", "UNKNOWN"].includes(row.state)) return;
      const limit = uploadSizeLimitFor({ mimeType: row.file.type });
      if (row.file.size === 0 || row.file.size > limit.maxBytes) return;
      row.state = "QUEUED"; emit(); void pump();
    },
    exclude(id: string) {
      if (rows.some(row => row.clientMutationId === id && row.state === "UPLOADING")) return;
      rows = rows.filter(row => row.clientMutationId !== id); emit();
    },
  };
}

/** Тот же одиночный multipart endpoint; прогресс относится к отправке одного файла. */
export function uploadFinanceDocumentFile(row: FinanceUploadRow, progress: (value: number) => void): Promise<FinanceDocumentView> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/finance/documents/upload");
    request.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    const unknown = () => reject(new FinanceUploadFailure("Подтверждение не получено. Повторите этот файл или исключите его из операции.", true));
    request.onerror = unknown; request.onabort = unknown; request.ontimeout = unknown;
    request.onload = () => {
      let body: { ok?: boolean; document?: FinanceDocumentView; error?: string; commitState?: string };
      try { body = JSON.parse(request.responseText); } catch { unknown(); return; }
      if (request.status >= 200 && request.status < 300 && body.ok && body.document?.id) { resolve(body.document); return; }
      reject(new FinanceUploadFailure(body.error ?? "Не удалось подтвердить загрузку", body.commitState !== "notCommitted"));
    };
    const form = new FormData(); form.set("file", row.file); form.set("clientMutationId", row.clientMutationId);
    request.send(form);
  });
}
