/** Чтение флага не запускает задания и не обращается к БД или хранилищу. */
export function isKpEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.PERO_KP_ENABLED === "1";
}
