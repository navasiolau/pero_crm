import { encodeListFilterValue, parseListFilterValue } from "./list-filter-values";

export const expenseChoiceFields = {
  purpose: "Проект / назначение",
  cash: "Касса",
  article: "Статья",
  currency: "Валюта",
  documentPresence: "Наличие документа",
  material: "Материал на складе",
  stockUnit: "Единица материала",
} as const;

export const expenseTextFields = {
  id: "ID расхода",
  comment: "Комментарий",
  document: "Имя документа",
  movement: "ID складского движения",
} as const;

export const expenseRangeFields = {
  date: { label: "Дата расхода", type: "date" },
  rateDate: { label: "Дата курса", type: "date" },
  amount: { label: "Сумма в валюте", type: "number" },
  byn: { label: "Эквивалент BYN", type: "number" },
  rate: { label: "Курс", type: "number" },
  stockQty: { label: "Количество на складе", type: "number" },
  stockUnitPrice: { label: "Цена единицы в валюте", type: "number" },
  stockValueByn: { label: "Стоимость запаса BYN", type: "number" },
} as const;

export const expenseSortFields = ["id", "date", "cash", "article", "amount", "byn"] as const;

export function normalizeExpenseFilters(source: URLSearchParams, result: URLSearchParams) {
  for (const key of Object.keys(expenseChoiceFields)) {
    const encoded = encodeListFilterValue(parseListFilterValue(source.get(key) ?? undefined));
    if (encoded) result.set(key, encoded);
  }
  for (const key of Object.keys(expenseTextFields)) {
    const value = source.get(key)?.trim().slice(0, 128);
    if (value) result.set(key, value);
  }
  for (const [field, { type }] of Object.entries(expenseRangeFields)) {
    for (const suffix of ["From", "To"]) {
      const key = field + suffix;
      const value = (source.get(key)?.trim() ?? "").replace(",", ".");
      if (type === "number" && /^-?\d{1,14}(\.\d{1,6})?$/.test(value)) result.set(key, value);
      if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01") {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value) result.set(key, value);
      }
    }
  }
}
