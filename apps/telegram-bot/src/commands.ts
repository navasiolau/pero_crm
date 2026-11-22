export const BOT_COMMAND = {
  help: "/команды",
  newProject: "/новый_проект",
  verifyOperation: "/проверить_операцию",
  stockIssue: "/выдать_материал",
  stockReturn: "/возврат_на_склад",
  inventoryReceipt: "/приход_на_склад",
} as const;

const aliases = new Map<string, string>([
  ["/help", BOT_COMMAND.help],
  ["/новый", BOT_COMMAND.newProject],
  ["/new", BOT_COMMAND.newProject],
  ["/повтор", BOT_COMMAND.verifyOperation],
  ["/retry", BOT_COMMAND.verifyOperation],
  ["/выдача", BOT_COMMAND.stockIssue],
  ["/stockout", BOT_COMMAND.stockIssue],
  ["/возврат", BOT_COMMAND.stockReturn],
  ["/stockreturn", BOT_COMMAND.stockReturn],
  ["/инвприход", BOT_COMMAND.inventoryReceipt],
  ["/stockinventory", BOT_COMMAND.inventoryReceipt],
]);

export function canonicalBotCommand(command: string): string {
  return aliases.get(command) ?? command;
}
