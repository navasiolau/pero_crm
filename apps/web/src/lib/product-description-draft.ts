// Textarea показывает CRLF/CR как LF; сравнение не меняет сохранённый CAS baseline.
export function isUnchangedProductDescriptionDraft(draft: string, baseline: string | null): boolean {
  const raw = baseline ?? "";
  return draft === raw || draft === raw.replace(/\r\n?/g, "\n");
}
