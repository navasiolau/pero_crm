export type DecimalInput = string | number | { toString(): string };
export type TaskAllocationValues = {
  quantity: DecimalInput | null;
  executorShare: DecimalInput;
  allocationGroupId?: string | null;
  shareUnits?: number | null;
  shareAmount?: DecimalInput | null;
};

export const FULL_SHARE_UNITS = 1_000_000;

function scaled(value: DecimalInput, digits: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match || (match[2]?.slice(digits).replace(/0/g, "") ?? "")) throw new Error("Некорректное число или слишком много знаков после запятой");
  return BigInt(match[1] + (match[2] ?? "").slice(0, digits).padEnd(digits, "0"));
}

function fixed(value: bigint, digits: number): string {
  const negative = value < BigInt(0);
  const text = (negative ? -value : value).toString().padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

export const quantityAtoms = (value: DecimalInput) => scaled(value, 2);
export const moneyAtoms = (value: DecimalInput) => scaled(value, 2);
export const quantityFromAtoms = (value: bigint) => fixed(value, 2);

export function allocatedWorkQuantity(tasks: Pick<TaskAllocationValues, "quantity" | "allocationGroupId">[]): string {
  let total = BigInt(0);
  const groups = new Map<string, bigint>();
  for (const task of tasks) {
    const quantity = quantityAtoms(task.quantity ?? 0);
    if (task.allocationGroupId) {
      const existing = groups.get(task.allocationGroupId);
      if (existing !== undefined) {
        if (existing !== quantity) throw new Error("Объём частей общей работы не согласован");
        continue;
      }
      groups.set(task.allocationGroupId, quantity);
    }
    total += quantity;
  }
  return fixed(total, 2);
}

export function taskPieceAmount(task: TaskAllocationValues, unitPrice: DecimalInput): string {
  if (task.allocationGroupId) {
    if (task.shareAmount === null || task.shareAmount === undefined) throw new Error("У доли отсутствует денежный снимок");
    return fixed(moneyAtoms(task.shareAmount), 2);
  }
  const product = scaled(unitPrice, 2) * scaled(task.quantity ?? 1, 2) * scaled(task.executorShare, 3);
  // Existing price × quantity × legacy coefficient; round half up once to cents.
  return fixed((product + BigInt(50_000)) / BigInt(100_000), 2);
}

export function splitAllocation(shareUnits: number, amount: DecimalInput, transferPercent: DecimalInput) {
  const percent = scaled(transferPercent, 2);
  if (percent <= BigInt(0) || percent >= BigInt(10_000)) throw new Error("Передайте от 0,01 до 99,99 процента");
  if (!Number.isSafeInteger(shareUnits) || shareUnits < 1 || shareUnits > FULL_SHARE_UNITS) throw new Error("Некорректная доля задачи");
  const transferredUnits = Number(BigInt(shareUnits) * percent / BigInt(10_000));
  if (transferredUnits < 1 || transferredUnits >= shareUnits) throw new Error("Передаваемая доля слишком мала — увеличьте процент");
  const total = moneyAtoms(amount);
  const transferred = total * percent / BigInt(10_000);
  return {
    remainingUnits: shareUnits - transferredUnits,
    transferredUnits,
    remainingAmount: fixed(total - transferred, 2),
    transferredAmount: fixed(transferred, 2),
    percent: fixed(percent, 2),
  };
}

export function personalQuantity(task: TaskAllocationValues): string | null {
  if (task.quantity === null) return null;
  const units = task.allocationGroupId ? task.shareUnits : FULL_SHARE_UNITS;
  if (!units || !Number.isSafeInteger(units) || units < 1 || units > FULL_SHARE_UNITS) throw new Error("Некорректная доля задачи");
  return fixed(quantityAtoms(task.quantity) * BigInt(units), 8).replace(/\.?0+$/, "");
}

export function sharePercent(units = FULL_SHARE_UNITS): string {
  return fixed(BigInt(units), 4).replace(/\.?0+$/, "");
}
