// Чистая арифметика фонда. Нет I/O, Prisma, ролей или чтения денежных legacy-полей.
export const STAGE_SHARE_UNITS = BigInt(1000000);
export type StageCurrency = "BYN" | "RUB" | "USD" | "EUR";
export type StageCreatedAt = string | Date;
export interface StageFundInput {
  price: string | null;
  ratePercent: string | null;
  productCurrency: StageCurrency;
  payrollCurrency: StageCurrency;
  productRateByn: string | null;
  payrollRateByn: string | null;
}
export interface StageAmounts { amount: string; bynAmount: string; projectAmount: string }
export interface StageFund extends StageAmounts { sourceFundExact: string }
export interface StageTaskWeight { id: string; userId: string; stageShareUnits: bigint; createdAt: StageCreatedAt }
export interface StageWorkWeight { id: string; poolWeightUnits: bigint; createdAt: StageCreatedAt; tasks: readonly StageTaskWeight[] }
export interface StageWeightedRow { id: string; units: bigint; createdAt: StageCreatedAt }
export interface StageDistribution {
  works: (StageAmounts & { id: string; tasks: (StageAmounts & { id: string; userId: string })[] })[];
  beneficiaries: (StageAmounts & { userId: string })[];
}
export interface StageSplitInput { quantityShareUnits: bigint; stageShareUnits: bigint; percent: string }
export class StagePayMathError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "StagePayMathError"; }
}
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const PERCENT_SCALE = BigInt(10000);
const MICRO_SCALE = BigInt(1000000);
const MAX_MONEY_MINOR = BigInt("999999999999"); // NUMERIC(12,2)
const MAX_LARGE_MINOR = BigInt("999999999999999999"); // NUMERIC(18,s)
const currencies: readonly StageCurrency[] = ["BYN", "RUB", "USD", "EUR"];

function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new StagePayMathError(code, message);
}

/** Только decimal text: binary float, exponent, NaN и лишние значащие знаки запрещены. */
function decimal(text: string | null, precision: number, scale: number, field: string): bigint {
  ensure(text !== null && text !== undefined, `${field}_REQUIRED`, "Значение для расчёта не задано");
  ensure(typeof text === "string" && text.length <= 128, `${field}_INVALID`, "Нужно точное десятичное значение");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  ensure(match, `${field}_INVALID`, "Некорректное десятичное значение");
  const fraction = match[2] ?? "";
  ensure(!/[1-9]/.test(fraction.slice(scale)), `${field}_PRECISION`, "Слишком много знаков после запятой");
  const value = BigInt(match[1] + fraction.slice(0, scale).padEnd(scale, "0"));
  const max = BigInt("9".repeat(precision));
  ensure(value <= max, `${field}_OVERFLOW`, "Значение превышает допустимый предел");
  return value;
}

function fixed(value: bigint, scale: number): string {
  const text = value.toString().padStart(scale + 1, "0");
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  ensure(numerator >= ZERO && denominator > ZERO, "INVALID_RATIO", "Некорректное отношение для расчёта");
  return numerator / denominator + (numerator % denominator * TWO >= denominator ? ONE : ZERO);
}

function moneyLimit(value: bigint, max: bigint, code: string): bigint {
  ensure(value >= ZERO && value <= max, code, "Рассчитанная сумма превышает допустимый предел");
  return value;
}

export function calculateStageFund(input: StageFundInput): StageFund {
  ensure(currencies.includes(input.productCurrency) && currencies.includes(input.payrollCurrency), "CURRENCY_UNSUPPORTED", "Неизвестная валюта расчёта");
  const price = decimal(input.price, 12, 2, "PRICE");
  const rate = decimal(input.ratePercent, 5, 2, "RATE");
  ensure(rate <= PERCENT_SCALE, "RATE_OUT_OF_RANGE", "Ставка должна быть от 0 до 100 процентов");
  const productFx = decimal(input.productRateByn, 18, 6, "PRODUCT_FX");
  const payrollFx = decimal(input.payrollRateByn, 18, 6, "PAYROLL_FX");
  ensure(productFx > ZERO && payrollFx > ZERO, "FX_NON_POSITIVE", "Курс должен быть положительным");
  ensure((input.productCurrency !== "BYN" || productFx === MICRO_SCALE) &&
    (input.payrollCurrency !== "BYN" || payrollFx === MICRO_SCALE), "BYN_RATE_MISMATCH", "Курс BYN должен равняться единице");
  ensure(input.productCurrency !== input.payrollCurrency || productFx === payrollFx, "SAME_CURRENCY_RATE_MISMATCH", "Для одинаковой валюты нужен один согласованный курс");

  // price имеет scale2, процент scale2; после /100 источник точно имеет scale6.
  const sourceMicro = moneyLimit(price * rate, MAX_LARGE_MINOR, "SOURCE_FUND_OVERFLOW");
  const amount = moneyLimit(halfUp(sourceMicro * productFx * HUNDRED, MICRO_SCALE * payrollFx), MAX_MONEY_MINOR, "AMOUNT_OVERFLOW");
  // Эквиваленты относятся к фактической округлённой зарплате, не к sourceMicro.
  const byn = moneyLimit(halfUp(amount * payrollFx, MICRO_SCALE), MAX_LARGE_MINOR, "BYN_AMOUNT_OVERFLOW");
  const project = moneyLimit(halfUp(amount * payrollFx, productFx), MAX_MONEY_MINOR, "PROJECT_AMOUNT_OVERFLOW");
  return { sourceFundExact: fixed(sourceMicro, 6), amount: fixed(amount, 2), bynAmount: fixed(byn, 2), projectAmount: fixed(project, 2) };
}

function validUnits(value: bigint, allowZero: boolean): void {
  ensure(typeof value === "bigint" && value >= (allowZero ? ZERO : ONE) && value <= STAGE_SHARE_UNITS, "UNITS_INVALID", "Некорректная доля распределения");
}

function createdAtKey(value: StageCreatedAt): string {
  ensure(typeof value === "string" || value instanceof Date, "CREATED_AT_INVALID", "Дата создания для распределения не задана");
  try { return (value instanceof Date ? value : new Date(value)).toISOString(); }
  catch { throw new StagePayMathError("CREATED_AT_INVALID", "Некорректная дата создания"); }
}

/** Целые minor units; результат остаётся в исходном порядке, tie-break не зависит от него. */
export function allocateStageMinorUnits(total: bigint, rows: readonly StageWeightedRow[]): { id: string; amountMinor: bigint }[] {
  ensure(typeof total === "bigint", "TOTAL_INVALID", "Сумма должна быть задана в целых минимальных единицах");
  moneyLimit(total, MAX_LARGE_MINOR, "ALLOCATION_OVERFLOW");
  ensure(rows.length > 0, "WEIGHTS_EMPTY", "Распределение не задано");
  const ids = new Set<string>();
  let sum = ZERO;
  const allocated = rows.map((row) => {
    ensure(typeof row.id === "string" && row.id.length > 0 && !ids.has(row.id), "ALLOCATION_ID_INVALID", "Участники распределения должны иметь разные идентификаторы");
    ids.add(row.id);
    validUnits(row.units, true);
    sum += row.units;
    const numerator = total * row.units;
    return { id: row.id, units: row.units, createdAt: createdAtKey(row.createdAt), amountMinor: numerator / STAGE_SHARE_UNITS, remainder: numerator % STAGE_SHARE_UNITS };
  });
  ensure(sum === STAGE_SHARE_UNITS, "WEIGHT_SUM_INVALID", "Распределение должно составлять ровно 100 процентов");
  let remaining = total - allocated.reduce((sum, row) => sum + row.amountMinor, ZERO);
  const order = allocated.filter((row) => row.units > ZERO).sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const row of order) {
    if (remaining === ZERO) break;
    row.amountMinor += ONE;
    remaining -= ONE;
  }
  ensure(remaining === ZERO, "ALLOCATION_INVARIANT", "Не удалось сохранить итог распределения");
  return allocated.map(({ id, amountMinor }) => ({ id, amountMinor }));
}

type MinorTotals = { amount: bigint; bynAmount: bigint; projectAmount: bigint };
const display = (value: MinorTotals): StageAmounts => ({ amount: fixed(value.amount, 2), bynAmount: fixed(value.bynAmount, 2), projectAmount: fixed(value.projectAmount, 2) });

export function distributeStageFund(fund: StageAmounts, works: readonly StageWorkWeight[]): StageDistribution {
  const total: MinorTotals = { amount: decimal(fund.amount, 12, 2, "AMOUNT"), bynAmount: decimal(fund.bynAmount, 18, 2, "BYN_AMOUNT"), projectAmount: decimal(fund.projectAmount, 12, 2, "PROJECT_AMOUNT") };
  const weights = works.map((work) => ({ id: work.id, units: work.poolWeightUnits, createdAt: work.createdAt }));
  const workAmount = allocateStageMinorUnits(total.amount, weights);
  const workByn = allocateStageMinorUnits(total.bynAmount, weights);
  const workProject = allocateStageMinorUnits(total.projectAmount, weights);
  const taskIds = new Set<string>();
  const beneficiaries = new Map<string, MinorTotals>();
  const allocatedWorks = works.map((work, workIndex) => {
    const totals = { amount: workAmount[workIndex].amountMinor, bynAmount: workByn[workIndex].amountMinor, projectAmount: workProject[workIndex].amountMinor };
    const shares = work.tasks.map((task) => {
      ensure(!taskIds.has(task.id), "TASK_ID_DUPLICATED", "Одна задача не может входить в несколько работ фонда");
      ensure(typeof task.userId === "string" && task.userId.length > 0, "BENEFICIARY_REQUIRED", "Получатель доли не задан");
      taskIds.add(task.id);
      return { id: task.id, units: task.stageShareUnits, createdAt: task.createdAt };
    });
    const taskAmount = allocateStageMinorUnits(totals.amount, shares);
    const taskByn = allocateStageMinorUnits(totals.bynAmount, shares);
    const taskProject = allocateStageMinorUnits(totals.projectAmount, shares);
    const tasks = work.tasks.map((task, taskIndex) => {
      const amounts = { amount: taskAmount[taskIndex].amountMinor, bynAmount: taskByn[taskIndex].amountMinor, projectAmount: taskProject[taskIndex].amountMinor };
      const current = beneficiaries.get(task.userId) ?? { amount: ZERO, bynAmount: ZERO, projectAmount: ZERO };
      beneficiaries.set(task.userId, { amount: current.amount + amounts.amount, bynAmount: current.bynAmount + amounts.bynAmount, projectAmount: current.projectAmount + amounts.projectAmount });
      return { id: task.id, userId: task.userId, ...display(amounts) };
    });
    return { id: work.id, ...display(totals), tasks };
  });
  return { works: allocatedWorks, beneficiaries: [...beneficiaries.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([userId, values]) => ({ userId, ...display(values) })) };
}

export function splitStageShareVectors(input: StageSplitInput) {
  validUnits(input.quantityShareUnits, false);
  validUnits(input.stageShareUnits, true);
  const percent = decimal(input.percent, 5, 2, "SPLIT_PERCENT");
  ensure(percent > ZERO && percent < PERCENT_SCALE, "SPLIT_PERCENT_INVALID", "Передайте от 0,01 до 99,99 процента");
  const quantity = input.quantityShareUnits * percent / PERCENT_SCALE;
  const stage = input.stageShareUnits * percent / PERCENT_SCALE;
  ensure(quantity > ZERO, "PHYSICAL_TRANSFER_TOO_SMALL", "Передаваемая доля объёма слишком мала");
  ensure(input.stageShareUnits === ZERO || stage > ZERO, "STAGE_TRANSFER_TOO_SMALL", "Передаваемая финансовая доля слишком мала");
  return { remainingQuantityShareUnits: input.quantityShareUnits - quantity, transferredQuantityShareUnits: quantity,
    remainingStageShareUnits: input.stageShareUnits - stage, transferredStageShareUnits: stage };
}

/** Эффективный объём: source quantity(scale2) × physical units(scale6), без потерь до scale8. */
export function physicalStageQuantity(quantity: string, units: bigint): string {
  validUnits(units, false);
  const source = decimal(quantity, 10, 2, "QUANTITY");
  ensure(source > ZERO, "QUANTITY_NON_POSITIVE", "Количество должно быть положительным");
  return fixed(source * units, 8).replace(/0+$/, "").replace(/\.$/, "");
}
