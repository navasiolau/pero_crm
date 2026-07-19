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
