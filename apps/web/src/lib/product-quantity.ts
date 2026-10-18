import { allocatedWorkQuantity, type DecimalInput, type TaskAllocationValues } from "./work-shares";

export function assertProductQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2_147_483_647)
    throw new Error("Количество изделий должно быть целым числом от 1 до 2 147 483 647");
  return quantity;
}

export function decimalAtoms(value: DecimalInput, scale: number, precision: number): bigint {
  const text = String(value).trim();
  const match = text.length <= 128 && /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || /[1-9]/.test((match[2] ?? "").slice(scale)))
    throw new Error("Некорректное число или слишком много знаков после запятой");
  const atoms = BigInt(match[1] + (match[2] ?? "").slice(0, scale).padEnd(scale, "0"));
  assertDecimalRange(atoms, precision);
  return atoms;
}

function assertDecimalRange(atoms: bigint, precision: number) {
  if (atoms < BigInt(0) || atoms > BigInt("9".repeat(precision)))
    throw new Error("Объём или сумма превышают допустимый предел");
}

export function decimalText(atoms: bigint, scale: number): string {
  const negative = atoms < BigInt(0);
  const text = (negative ? -atoms : atoms).toString().padStart(scale + 1, "0");
  return `${negative ? "-" : ""}${text.slice(0, -scale)}.${text.slice(-scale)}`;
}

export function scaleNorm(norm: DecimalInput, quantity: number, scale: number, precision: number): string {
  assertProductQuantity(quantity);
  const result = decimalAtoms(norm, scale, precision) * BigInt(quantity);
  assertDecimalRange(result, precision);
  return decimalText(result, scale);
}

export function productLineTotal(price: DecimalInput | null, quantity = 1): string | null {
  assertProductQuantity(quantity);
  return price === null ? null : scaleNorm(price, quantity, 2, 12);
}

export function productsTotal(products: readonly { expectedPrice: DecimalInput | null; quantity?: number }[]): string {
  return decimalText(products.reduce((sum, product) =>
    sum + decimalAtoms(productLineTotal(product.expectedPrice, product.quantity ?? 1) ?? "0", 2, 12), BigInt(0)), 2);
}

export type ProjectServices = { servicesTotal?: DecimalInput | null; delivery?: DecimalInput | null; unloading?: DecimalInput | null; installation?: DecimalInput | null; proposalRoundingAdjustment?: DecimalInput | null };

export function signedMoneyAtoms(value: DecimalInput): bigint {
  const text = String(value).trim();
  return text.startsWith("-") ? -decimalAtoms(text.slice(1), 2, 12) : decimalAtoms(text, 2, 12);
}

export function projectServiceAtoms(services: ProjectServices): bigint {
  const breakdown = [services.delivery, services.unloading, services.installation];
  if (services.servicesTotal !== undefined && services.servicesTotal !== null) {
    if (breakdown.some(value => value !== undefined && value !== null)) throw Error("Общая сумма услуг несовместима с разбивкой");
    return decimalAtoms(services.servicesTotal, 2, 12);
  }
  return breakdown.reduce<bigint>((sum, value) => sum + decimalAtoms(value ?? "0", 2, 12), BigInt(0));
}

export function projectTotalText(products: readonly { expectedPrice: DecimalInput | null; quantity?: number }[], services: ProjectServices = {}): string {
  const atoms = decimalAtoms(productsTotal(products), 2, 18) + projectServiceAtoms(services) + signedMoneyAtoms(services.proposalRoundingAdjustment ?? "0");
  if (atoms < BigInt(0)) throw Error("Итог проекта не может быть отрицательным");
  return decimalText(atoms, 2);
}

export function projectTotal(products: readonly { expectedPrice: DecimalInput | null; quantity?: number }[], services: ProjectServices = {}): number {
  const total = projectTotalText(products, services);
  const atoms = decimalAtoms(total, 2, 18);
  if (atoms > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Сумма превышает безопасный предел");
  return Number(total);
}

export function workBudget(price: DecimalInput, quantity: DecimalInput): string {
  const atoms = (decimalAtoms(price, 2, 12) * decimalAtoms(quantity, 2, 10) + BigInt(50)) / BigInt(100);
  assertDecimalRange(atoms, 12);
  return decimalText(atoms, 2);
}

export function inputNorm(input: { quantity?: number; quantityPerUnit?: number }, count: number, scale: number, precision: number): string {
  assertProductQuantity(count);
  if ((input.quantity === undefined) === (input.quantityPerUnit === undefined))
    throw new Error("Укажите количество на одно изделие");
  if (input.quantityPerUnit === undefined && count !== 1)
    throw new Error("Количество изделий изменилось — обновите форму и укажите норму на одно изделие");
  const atoms = decimalAtoms(input.quantityPerUnit ?? input.quantity!, scale, precision);
  if (atoms === BigInt(0)) throw new Error("Количество должно быть больше нуля");
  return decimalText(atoms, scale);
}

export function existingNorm(norm: DecimalInput | null, total: DecimalInput, count: number): DecimalInput {
  if (norm !== null) return norm;
  if (count !== 1) throw new Error("У партии отсутствует норма на одно изделие — обновите данные");
  return total;
}

export function materialDebt(total: DecimalInput, issued: DecimalInput): number {
  const atoms = decimalAtoms(total, 3, 18) - decimalAtoms(issued, 3, 18);
  return Number(decimalText(atoms > BigInt(0) ? atoms : BigInt(0), 3));
}

export type QuantityWork = {
  id: string; title: string; quantity: DecimalInput; quantityPerUnit: DecimalInput | null;
  priceSnapshot: DecimalInput | null; paymentKind: string;
  tasks: Pick<TaskAllocationValues, "quantity" | "allocationGroupId">[];
};
export type QuantityMaterial = {
  id: string; quantity: DecimalInput; quantityPerUnit: DecimalInput | null; issuedQty: DecimalInput;
  material: { name: string };
};

// Over-issue is a physical fact, not an instruction to enlarge the plan.
// Ordinary rows retain the previous floor at the issued quantity.
export function materialPlanFloor(quantity: DecimalInput, issuedQty: DecimalInput): string {
  const planned = decimalAtoms(quantity, 3, 12), issued = decimalAtoms(issuedQty, 3, 12);
  return decimalText(planned < issued ? planned : issued, 3);
}

// Сначала проверяем весь план. Ни один факт и ни одна задача не меняются.
export function planQuantityChange(oldCount: number, count: number, works: QuantityWork[], materials: QuantityMaterial[]) {
  assertProductQuantity(count);
  const workUpdates = works.filter((work) => work.paymentKind === "LEGACY").map((work) => {
    const norm = existingNorm(work.quantityPerUnit, work.quantity, oldCount);
    const quantity = scaleNorm(norm, count, 2, 10);
    const allocated = allocatedWorkQuantity(work.tasks);
    if (decimalAtoms(quantity, 2, 10) < decimalAtoms(allocated, 2, 10))
      throw new Error(`Работа «${work.title}»: уже распределено ${allocated}; уменьшите распределение перед количеством изделий`);
    return { id: work.id, quantityPerUnit: decimalText(decimalAtoms(norm, 2, 10), 2),
      quantity, total: work.priceSnapshot === null ? null : workBudget(work.priceSnapshot, quantity) };
  });
  const materialUpdates = materials.map((line) => {
    const norm = existingNorm(line.quantityPerUnit, line.quantity, oldCount);
    const quantity = scaleNorm(norm, count, 3, 12);
    if (decimalAtoms(quantity, 3, 12) < decimalAtoms(materialPlanFloor(line.quantity, line.issuedQty), 3, 12))
      throw new Error(`Материал «${line.material.name}»: уже выдано ${line.issuedQty}; сначала верните излишек`);
    return { id: line.id, quantityPerUnit: decimalText(decimalAtoms(norm, 3, 12), 3), quantity };
  });
  return { works: workUpdates, materials: materialUpdates };
}
