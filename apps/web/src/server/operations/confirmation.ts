import type { Prisma } from "@prisma/client";
import type { TaskTransaction } from "@/server/tasks/transaction";

export type MutationOutcome<T> =
  | { outcome: "COMMITTED"; value: T; recovered: boolean }
  | { outcome: "ROLLED_BACK"; error: unknown }
  | { outcome: "UNKNOWN"; error: unknown };

/** Возвращённый callback ещё не подтверждает commit. Проверка никогда не повторяет запись. */
export async function confirmMutation<T>(transaction: TaskTransaction,
  mutation: (tx: Prisma.TransactionClient) => Promise<T>,
  verify: (tx: Prisma.TransactionClient, candidate: T | undefined) => Promise<T | null>,
): Promise<MutationOutcome<T>> {
  let started = false, completed = false;
  let candidate: T | undefined;
  try {
    const value = await transaction(async tx => {
      started = true;
      const result = await mutation(tx);
      candidate = result; completed = true;
      return result;
    });
    return { outcome: "COMMITTED", value, recovered: false };
  } catch (error) {
    if (!started) return { outcome: "ROLLED_BACK", error };
    try {
      // Fresh transaction ждёт ту же блокировку: прежняя transaction уже закончилась.
      return await transaction(async tx => {
        const confirmed = await verify(tx, candidate);
        if (confirmed !== null) return { outcome: "COMMITTED" as const, value: confirmed, recovered: true };
        // Callback бросил до COMMIT; успешная fresh fence подтверждает окончание abort.
        return completed ? { outcome: "UNKNOWN" as const, error } : { outcome: "ROLLED_BACK" as const, error };
      });
    } catch {
      return { outcome: "UNKNOWN", error };
    }
  }
}
