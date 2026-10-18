export const KP_API_SCOPES = ["kp:read", "kp:write", "kp:media:write", "kp:export", "kp:contracts:read", "kp:contracts:write", "kp:contracts:generate"] as const;
export type KpApiScope = typeof KP_API_SCOPES[number];
export const KP_AGENT_SCOPES: readonly KpApiScope[] = KP_API_SCOPES;
export const KP_SCOPE_LABELS: Record<KpApiScope, string> = {
  "kp:read": "КП: чтение и версии", "kp:write": "КП: создание, изменение и восстановление",
  "kp:media:write": "КП: загрузка изображений", "kp:export": "КП: выпуск PDF",
  "kp:contracts:read": "Договоры: чтение", "kp:contracts:write": "Договоры: настройки",
  "kp:contracts:generate": "Договоры: выпуск и переход проектов в «Договор»",
};
