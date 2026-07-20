import type { CommunicationType } from "@prisma/client";

// Подписи типов коммуникаций — общий модуль для сервера и клиента
// (из "use server"-файлов нестандартные экспорты запрещены).
export const communicationTypeLabels: Record<CommunicationType, string> = {
  CALL: "Звонок",
  EMAIL: "Письмо",
  MESSENGER: "Мессенджер",
  MEETING: "Встреча",
  NOTE: "Заметка",
};

// Склад (§12): типы движений и статусы строк потребности проекта
export const stockMovementTypeLabels: Record<string, string> = {
  INCOME: "Приход",
  EXPENSE: "Списание",
  RETURN: "Возврат",
};

export const projectMaterialStatusLabels: Record<string, string> = {
  FULFILLED: "Обеспечено",
  AVAILABLE: "Можно запросить",
  SHORTAGE: "Нет на складе",
};

// Единицы измерения номенклатуры (из legacy 1421, MVP-набор)
export const MATERIAL_UNITS = [
  "шт",
  "м²",
  "м.п.",
  "лист",
  "кг",
  "м",
  "компл",
  "упак",
] as const;

// Схемы оплаты сотрудника (§10)
export const paySchemeLabels: Record<string, string> = {
  PIECE: "Сдельная",
  PERCENT_PROJECT: "% от стоимости",
  PERCENT_TURNOVER: "% от оборота",
  NONE: "Без расчёта",
};

// Подписи схем в начислениях (короткие, для таблиц расчётника)
export const entrySchemeLabels: Record<string, string> = {
  PIECE: "Сдельно",
  PERCENT_PROJECT: "% от стоимости",
  PERCENT_TURNOVER: "% от оборота",
};

// Отображаемое имя клиента: «Фамилия Имя Отчество», а если заполнено
// только имя — как есть (подходит и юрлицам: «ООО Альфа»).
export function displayClientName(client: {
  name: string;
  lastName?: string | null;
  middleName?: string | null;
}): string {
  const parts = [client.lastName, client.name, client.middleName].filter(
    (part) => part && part.trim().length > 0,
  );
  return parts.length > 1 ? parts.join(" ") : client.name;
}
