/** Прежний перенос №193 заменён транзакционной Prisma-миграцией №209. */
export {};

// Совместимый CLI всегда inert; перенос выполняет только Prisma-миграция.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/retire-stages.ts")) {
  process.stdout.write("INERT: перенос заменён миграцией 20261102120000_remove_retired_stage_enums. Этот инструмент не подключается к БД и больше не выполняет перенос.\n");
  if (process.argv.length > 2) process.exitCode = 2;
}
