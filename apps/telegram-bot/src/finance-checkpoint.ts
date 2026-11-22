import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { crm } from "./crm";

type FinanceCommand = {
  kind: "payment" | "purchase";
  actorId: string;
  input: Record<string, unknown>;
};
const busy = new Set<number>();
const pendingPath = (chatId: number, actorId: string) =>
  join(config.financeStateDir, `${createHash("sha256").update(`${chatId}:${actorId}`).digest("hex")}.json`);

export function pendingFinanceCommand(chatId: number, actorId: string): FinanceCommand | undefined {
  try {
    const command = JSON.parse(readFileSync(pendingPath(chatId, actorId), "utf8")) as Partial<FinanceCommand>;
    if ((command.kind !== "payment" && command.kind !== "purchase") || command.actorId !== actorId ||
        typeof command.input?.clientMutationId !== "string") throw new Error("Некорректная сохранённая операция");
    return command as FinanceCommand;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function submitFinanceCommand(chatId: number, command: FinanceCommand) {
  if (busy.has(chatId)) return { ok: false, error: "Операция уже отправляется" };
  busy.add(chatId);
  try {
    const pending = pendingFinanceCommand(chatId, command.actorId);
    if (pending && JSON.stringify(pending) !== JSON.stringify(command)) {
      return { ok: false, error: "Сначала завершите сохранение предыдущей операции" };
    }
    if (!pending) {
      mkdirSync(config.financeStateDir, { recursive: true, mode: 0o700 });
      const temporary = join(config.financeStateDir, `.${chatId}.${randomUUID()}.tmp`);
      writeFileSync(temporary, JSON.stringify(command), { mode: 0o600, flag: "wx", flush: true });
      renameSync(temporary, pendingPath(chatId, command.actorId));
    }
    const result = await (command.kind === "payment" ? crm.createPayment : crm.createStockReceipt)(command.actorId, command.input);
    if (result.ok || result.outcome === "ROLLED_BACK") unlinkSync(pendingPath(chatId, command.actorId));
    return result;
  } finally {
    busy.delete(chatId);
  }
}
