"use client";
import { useCallback, useSyncExternalStore } from "react";
import type { InlineSaveController, InlineValue } from "@/lib/inline-save-controller";

// Текст сохраняется только по Enter/blur (Textarea: blur/Ctrl+Enter).
// Набор текста сам по себе не отправляет частично введённый общий телефон.
export function useInlineSave<V extends InlineValue>(controller: InlineSaveController<V>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const commit = useCallback(() => controller.commit(), [controller]);
  const flush = useCallback(() => controller.flush(), [controller]);
  return { ...state, setDraft: controller.setDraft, commit, flush, retry: controller.retry, acceptCurrent: controller.acceptCurrent, rebaseAndRetry: controller.rebaseAndRetry };
}
