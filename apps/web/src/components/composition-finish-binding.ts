export type FinishDraftBinding = {
  productId: string;
  revisionId: string;
  expectedDraftVersion: number;
};

export function captureFinishDraftBinding(
  productId: string,
  selected: { id: string; status: string; draftVersion: number } | null | undefined,
): FinishDraftBinding | null {
  if (!selected || selected.status !== "DRAFT") return null;
  return { productId, revisionId: selected.id, expectedDraftVersion: selected.draftVersion };
}

export function bindFinishDraftMutation<T extends object>(binding: FinishDraftBinding, payload: T): FinishDraftBinding & Omit<T, keyof FinishDraftBinding> {
  return { ...payload, ...binding };
}

export function finishMutationDisposition(kind: "stale" | "unknown", operation: "save" | "delete" = "save") {
  return {
    closeEditor: true,
    refresh: true,
    message: kind === "unknown"
      ? operation === "save"
        ? "Результат сохранения неизвестен. Проверьте карточку перед новой правкой."
        : "Результат удаления неизвестен. Проверьте карточку перед новым действием."
      : "Черновик изменился. Карточка обновлена; проверьте покрытие перед следующей правкой.",
  };
}
