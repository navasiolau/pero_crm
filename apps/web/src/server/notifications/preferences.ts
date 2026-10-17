// До разделения типов настройка выплат одновременно управляла и авансами.
export function notificationPreferenceTypes(type: string): string[] {
  return type === "payroll.orgAdvance" ? [type, "payroll.orgPayout"] : [type];
}

export function notificationPreferenceEnabled(type: string, preferences: ReadonlyMap<string, boolean>): boolean {
  for (const candidate of notificationPreferenceTypes(type)) {
    const enabled = preferences.get(candidate);
    if (enabled !== undefined) return enabled;
  }
  return true;
}
