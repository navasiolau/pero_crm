/** Safe user-facing messages for composition server action error codes. */
export const compositionErrorMessages: Record<string, string> = {
  NOT_AUTHENTICATED: "Войдите в CRM и повторите действие.",
  ACCESS_DENIED: "У вас нет права менять состав этого изделия.",
  PRODUCT_NOT_FOUND: "Изделие не найдено или недоступно.",
  DRAFT_NOT_FOUND: "Черновик состава не найден. Обновите карточку изделия.",
  DRAFT_VERSION_CHANGED: "Черновик изменился. Обновите карточку и повторите действие.",
  ITEM_NOT_FOUND: "Позиция состава не найдена в этом черновике.",
  ITEM_DELETE_CHANGED: "Состав изменился во время удаления. Обновите карточку и повторите действие.",
  EMPTY_COMPOSITION: "Добавьте хотя бы одну позицию перед подтверждением.",
  REQUEST_ID_INVALID: "Некорректный идентификатор запроса.",
  REQUEST_ID_REUSED: "Этот запрос уже использован для другого подтверждения.",
  DESIGNATION_REQUIRED: "Укажите обозначение позиции.",
  DUPLICATE_DESIGNATION: "Такое обозначение уже есть в составе.",
  DUPLICATE_LINEAGE: "Позиция уже присутствует в этой ревизии.",
  COMPOSITION_ID_INVALID: "Идентификатор позиции некорректен или повторяется.",
  COMPOSITION_KIND_INVALID: "Выберите тип позиции: модуль, деталь или фурнитура.",
  INSTALLATION_MARK_INVALID: "Некорректный признак поездки на монтаж.",
  TITLE_REQUIRED: "Укажите название позиции.",
  QUANTITY_OUT_OF_RANGE: "Количество должно быть целым от 1 до 1 000 000.",
  EFFECTIVE_QUANTITY_OVERFLOW: "Итоговое количество на изделие слишком велико.",
  COMPOSITION_ROWS_EXCEEDED: "В составе может быть не более 1000 позиций.",
  COMPOSITION_DEPTH_EXCEEDED: "Вложенность состава не может превышать 16 уровней.",
  COMPOSITION_CYCLE: "Позицию нельзя вложить в саму себя или своего потомка.",
  PARENT_NOT_FOUND: "Родительский модуль не найден.",
  PARENT_NOT_MODULE: "Родителем позиции может быть только модуль.",
  PARENT_REVISION_MISMATCH: "Родитель должен принадлежать той же ревизии.",
  REVISION_MISMATCH: "Позиции относятся к разным ревизиям.",
  SORT_ORDER_INVALID: "Некорректный порядок позиции.",
};

export function compositionErrorMessage(code: string): string {
  return compositionErrorMessages[code] ?? "Не удалось изменить состав. Обновите карточку и повторите действие.";
}
