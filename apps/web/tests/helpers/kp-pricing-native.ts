import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import { projectTotalText } from "../../src/lib/product-quantity";
import { projectProposalPricing, resolveProposalRate } from "../../src/server/kp/pricing";
import { applyProjectionInTransaction, type ProposalPricingContext } from "../../src/server/kp/pricing-persistence";
import type { ProposalFixedRateInput, ProposalPricingProjection } from "../../src/server/kp/pricing-contract";

type Money = string | null;
type PricingCase = {
  name: string;
  rate: ProposalFixedRateInput;
  lines: { price: string; qty: number }[];
  discount?: string;
  discountMode?: "amount" | "percent";
  delivery: Prisma.InputJsonObject;
  expected: {
    units: { gross: string; net: string }[];
    gross: string; total: string; printedTotal: string; rounding: string;
    services: readonly [Money, Money, Money, Money];
  };
};

const byn: ProposalFixedRateInput = { currency: "BYN", value: "1", date: "2026-10-18", source: "NBRB" };
const usd: ProposalFixedRateInput = { currency: "USD", value: "3.25", date: "2026-10-18", source: "MANUAL" };

// Ожидания заданы в копейках вручную и не вычисляются проверяемой проекцией.
const cases: readonly PricingCase[] = [
  { name: "usd-total-percent", rate: usd, lines: [{ price: "100", qty: 3 }, { price: "50", qty: 2 }], discount: "10", discountMode: "percent",
    delivery: { mode: "total", total: "40" }, expected: { units: [{ gross: "325.00", net: "292.50" }, { gross: "162.50", net: "146.25" }],
      gross: "1430.00", total: "1287.00", printedTotal: "396.00", rounding: "0.00", services: ["117.00", null, null, null] } },
  { name: "byn-split-amount", rate: byn, lines: [{ price: "100", qty: 2 }, { price: "30", qty: 1 }], discount: "26", discountMode: "amount",
    delivery: { mode: "items", items: [{ name: "Любая подпись A", crmKind: "DELIVERY", price: "10" },
      { name: "Любая подпись B", crmKind: "UNLOADING", price: "5" }, { name: "Любая подпись C", crmKind: "INSTALLATION", price: "15" }] },
    expected: { units: [{ gross: "100.00", net: "90.00" }, { gross: "30.00", net: "27.00" }],
      gross: "260.00", total: "234.00", printedTotal: "234.00", rounding: "0.00", services: [null, "9.00", "4.50", "13.50"] } },
  { name: "byn-off-negative-rounding", rate: byn, lines: [{ price: "1", qty: 3 }], discount: "0.01", discountMode: "amount",
    delivery: { visible: false, mode: "items", total: "999", items: [{ name: "Выключенная строка", price: "999" }] },
    expected: { units: [{ gross: "1.00", net: "1.00" }], gross: "3.00", total: "2.99", printedTotal: "2.99", rounding: "-0.01", services: [null, null, null, null] } },
  { name: "byn-off-positive-rounding", rate: byn, lines: [{ price: "1", qty: 3 }], discount: "0.02", discountMode: "amount",
    delivery: { visible: false, total: "999" }, expected: { units: [{ gross: "1.00", net: "0.99" }],
      gross: "3.00", total: "2.98", printedTotal: "2.98", rounding: "0.01", services: [null, null, null, null] } },
  { name: "usd-fractional-rate", rate: { ...usd, value: "3.005" }, lines: [{ price: "1", qty: 2 }], delivery: { visible: false },
    expected: { units: [{ gross: "3.01", net: "3.01" }], gross: "6.01", total: "6.01", printedTotal: "2.00", rounding: "-0.01", services: [null, null, null, null] } },
  { name: "usd-printed-rounding", rate: usd, lines: [{ price: "100.75", qty: 1 }], discount: "10", discountMode: "percent", delivery: { visible: false },
    expected: { units: [{ gross: "327.44", net: "294.71" }], gross: "327.44", total: "294.71", printedTotal: "90.68", rounding: "0.00", services: [null, null, null, null] } },
  { name: "byn-empty", rate: byn, lines: [], delivery: { visible: false },
    expected: { units: [], gross: "0.00", total: "0.00", printedTotal: "0.00", rounding: "0.00", services: [null, null, null, null] } },
];

const historyTables = ["PayrollEntry", "ProductPercentageCompletion", "ProductPercentageCompletionShare", "ProductPercentageAdjustment",
  "ProductStagePayPool", "ProductStageSettlement", "ProductStageSettlementShare", "WorkPaymentConversion", "Payment", "Payout"] as const;

async function historySnapshot(tx: Prisma.TransactionClient) {
  const sql = historyTables.map(table => `SELECT '${table}'::text AS name,count(*)::text AS count,
    md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${table}" t`).join(" UNION ALL ");
  const rows = await tx.$queryRawUnsafe<{ name: string; count: string; hash: string }[]>(sql);
  assert.equal(rows.length, historyTables.length, "KP182_HISTORY_SNAPSHOT_INCOMPLETE");
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

type Fixture = { scenario: PricingCase; state: Prisma.InputJsonObject; context: ProposalPricingContext; projection: ProposalPricingProjection };
const money = (value: Prisma.Decimal | null) => value === null ? null : value.toFixed(2);

async function commercialSnapshot(tx: Prisma.TransactionClient, fixture: Fixture) {
  const projectId = fixture.context.project.id;
  return {
    proposal: await tx.commercialProposal.findUniqueOrThrow({ where: { id: fixture.context.proposalId } }),
    project: await tx.project.findUniqueOrThrow({ where: { id: projectId } }),
    products: await tx.product.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
    audit: await tx.changeLog.findMany({ where: { entity: "project", entityId: projectId }, orderBy: { id: "asc" } }),
  };
}

async function assertPrices(tx: Prisma.TransactionClient, fixture: Fixture) {
  const { context, scenario } = fixture, projectId = context.project.id;
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  const products = await tx.product.findMany({ where: { projectId, deletedAt: null }, orderBy: { suffixInt: "asc" } });
  assert.equal(products.length, scenario.lines.length, "KP182_PRODUCT_COUNT_CHANGED");
  for (const [index, product] of products.entries()) {
    assert.ok(product.expectedPrice instanceof Prisma.Decimal && product.initialPrice instanceof Prisma.Decimal, "KP182_REAL_DECIMAL_REQUIRED");
    assert.equal(product.quantity, scenario.lines[index].qty, "KP182_QUANTITY_CHANGED");
    assert.equal(money(product.expectedPrice), scenario.expected.units[index].net, "KP182_NET_UNIT_PRICE_MISMATCH");
    assert.equal(money(product.initialPrice), scenario.expected.units[index].gross, "KP182_GROSS_UNIT_PRICE_MISMATCH");
    assert.equal(product.initialPriceCaptureEligible, false, "KP182_INITIAL_PRICE_PROTECTION_CHANGED");
  }
  assert.equal(project.currency, "BYN");
  assert.equal(money(project.initialPrice), scenario.expected.gross, "KP182_PROJECT_GROSS_MISMATCH");
  assert.deepEqual([money(project.servicesTotal), money(project.delivery), money(project.unloading), money(project.installation)],
    scenario.expected.services, "KP182_SERVICE_MODE_MISMATCH");
  assert.equal(money(project.proposalRoundingAdjustment), scenario.expected.rounding, "KP182_ROUNDING_MISMATCH");
  assert.equal(projectTotalText(products, project), scenario.expected.total, "KP182_SHARED_PROJECT_TOTAL_MISMATCH");
  const totals = await tx.$queryRaw<{ total: Prisma.Decimal }[]>`
    SELECT (COALESCE((SELECT SUM(p.quantity*p."expectedPrice") FROM "Product" p WHERE p."projectId"=q.id AND p."deletedAt" IS NULL),0)
      +COALESCE(q."servicesTotal",COALESCE(q.delivery,0)+COALESCE(q.unloading,0)+COALESCE(q.installation,0))
      +q."proposalRoundingAdjustment") AS total FROM "Project" q WHERE q.id=${projectId}`;
  assert.equal(totals.length, 1);
  assert.equal(money(totals[0].total), scenario.expected.total, "KP182_POSTGRES_TOTAL_MISMATCH");
  const proposal = await tx.commercialProposal.findUniqueOrThrow({ where: { id: context.proposalId } });
  assert.equal(proposal.currency, scenario.rate.currency);
  assert.equal(proposal.rate?.toString(), new Prisma.Decimal(scenario.rate.value).toString(), "KP182_FIXED_RATE_CHANGED");
  assert.equal(proposal.rateDate?.toISOString().slice(0, 10), scenario.rate.date);
  assert.equal(proposal.rateSource, scenario.rate.source);
  assert.deepEqual(proposal.state, fixture.state, "KP182_SOURCE_STATE_CHANGED");
}

/** Только существующая guarded rollback-транзакция. Соединений, commit и внешнего I/O здесь нет. */
export async function verifyProposalPricingNative(tx: Prisma.TransactionClient, actor: DomainActor, runId: string) {
  assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i, "KP182_RUN_ID_REQUIRED");
  const owner = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
  assert.ok(owner.active && actor.roles.some(role => ["ADMIN", "DIRECTOR", "MANAGER"].includes(role)), "KP182_ACTIVE_PRICING_ACTOR_REQUIRED");
  const prefix = `kp182-${runId}-`, now = new Date("2026-10-18T09:00:00.000Z");
  const client = await tx.client.create({ data: { id: prefix + "client", name: "Проверка цен КП182", phone: "KP182_NO_REAL_PHONE" } });
  const maximum = await tx.project.aggregate({ _max: { numberInt: true } });
  const firstNumber = (maximum._max.numberInt ?? 0) + 1;
  assert.ok(firstNumber > 0 && firstNumber + cases.length <= 2_147_483_647, "KP182_NUMBER_RANGE_REQUIRED");
  const fixtures: Fixture[] = [];
  for (const [index, scenario] of cases.entries()) {
    const numberInt = firstNumber + index, projectId = prefix + scenario.name, proposalId = projectId + "-proposal";
    await tx.project.create({ data: { id: projectId, number: String(numberInt), numberInt, title: "Проверка КП182: " + scenario.name,
      clientId: client.id, createdById: actor.id, managerId: actor.id, stage: "LEAD", currency: "BYN", initialPrice: "9999", delivery: "11", unloading: "22", installation: "33" } });
    const items = scenario.lines.map((line, itemIndex) => ({ id: `${projectId}-item${itemIndex + 1}`, price: line.price, qty: line.qty }));
    const state: Prisma.InputJsonObject = { currency: scenario.rate.currency, items, delivery: scenario.delivery,
      ...(scenario.discount === undefined ? {} : { discount: scenario.discount, discountMode: scenario.discountMode }) };
    await tx.commercialProposal.create({ data: { id: proposalId, projectId, clientId: client.id, createdById: actor.id, state,
      currency: scenario.rate.currency as "BYN" | "USD", rate: new Prisma.Decimal(scenario.rate.value), rateDate: now, rateSource: scenario.rate.source as "MANUAL" | "NBRB" } });
    const links: ProposalPricingContext["items"][number][] = [];
    for (const [itemIndex, item] of items.entries()) {
      const productId = `${projectId}-product${itemIndex + 1}`;
      await tx.product.create({ data: { id: productId, projectId, number: `${numberInt}.${itemIndex + 1}`, suffixInt: itemIndex + 1,
        title: "Тестовая позиция КП182", status: "DRAFT", quantity: item.qty, initialPrice: "999", expectedPrice: "999", initialPriceCaptureEligible: false } });
      await tx.proposalItem.create({ data: { id: item.id, proposalId, productId, position: itemIndex + 1, state: item } });
      links.push({ id: item.id, productId });
    }
    const projection = projectProposalPricing(state, scenario.rate);
    assert.equal(projection.source.total.toFixed(2), scenario.expected.printedTotal, "KP182_PRINTED_TOTAL_MISMATCH");
    fixtures.push({ scenario, state, projection, context: { proposalId, project: { id: projectId, stage: "LEAD", currency: "BYN" }, items: links, actor } });
  }

  // Реальные append-only факты с прежней ценой 999: новая цена КП не должна переписать их снимки.
  const first = fixtures[0], historicalProductId = first.context.items[0].productId;
  const completion = await tx.productPercentageCompletion.create({ data: { id: prefix + "completion", productId: historicalProductId,
    kind: "ENGINEERING", state: "SETTLED", completedAt: now, completedById: actor.id, statusAtCompletion: "PRODUCTION", calculationVersion: 1,
    priceSnapshot: "999", ratePercentSnapshot: "10", productCurrency: "BYN", payrollCurrency: "BYN", productRateByn: "1", payrollRateByn: "1",
    productRateDate: now, payrollRateDate: now, sourceFundExact: "99.9", amount: "99.90", bynAmount: "99.90", projectAmount: "99.90", settledAt: now } });
  const share = await tx.productPercentageCompletionShare.create({ data: { id: prefix + "completion-share", completionId: completion.id,
    userId: actor.id, userNameSnapshot: actor.name, shareUnits: 1_000_000, amount: "99.90", bynAmount: "99.90", projectAmount: "99.90" } });
  await tx.payrollEntry.create({ data: { id: prefix + "payroll", userId: actor.id, productId: historicalProductId, projectId: first.context.project.id,
    percentageCompletionShareId: share.id, amount: "99.90", bynAmount: "99.90", projectAmount: "99.90", currency: "BYN", projectCurrency: "BYN",
    scheme: "PRODUCT_PERCENT_ENGINEERING", month: "2026-10", comment: "Исторический снимок КП182" } });
  await tx.payment.create({ data: { id: prefix + "payment", projectId: first.context.project.id, direction: "INCOME", amount: "12.34", currency: "BYN",
    rate: "1", rateDate: now, bynAmount: "12.34", projectAmount: "12.34", createdById: actor.id, comment: "Факт оплаты КП182" } });
  const history = await historySnapshot(tx), completed: string[] = [];

  for (const fixture of fixtures) {
    const inputBefore = JSON.stringify(fixture.state);
    await applyProjectionInTransaction(tx, fixture.context, fixture.projection);
    await assertPrices(tx, fixture);
    assert.equal(JSON.stringify(fixture.state), inputBefore, "KP182_INPUT_MUTATED");
    assert.deepEqual(await historySnapshot(tx), history, "KP182_HISTORICAL_FACTS_CHANGED");
    const persisted = await tx.commercialProposal.findUniqueOrThrow({ where: { id: fixture.context.proposalId } });
    assert.ok(persisted.rate && persisted.rateDate && persisted.rateSource);
    let rateLookups = 0;
    const reused = await resolveProposalRate({ currency: persisted.currency, quoteDate: "2026-12-31",
      existing: { currency: persisted.currency, value: persisted.rate, date: persisted.rateDate, source: persisted.rateSource } },
    async () => { rateLookups++; throw Error("KP182_UNEXPECTED_RATE_LOOKUP"); });
    assert.equal(rateLookups, 0, "KP182_FIXED_RATE_REQUERIED");
    assert.equal(reused.date, "2026-10-18");
    await applyProjectionInTransaction(tx, fixture.context, projectProposalPricing(fixture.state, reused));
    await assertPrices(tx, fixture);
    assert.deepEqual(await historySnapshot(tx), history, "KP182_REPEATED_SAVE_CHANGED_HISTORY");
    const logs = await tx.changeLog.findMany({ where: { entity: "project", entityId: fixture.context.project.id, action: "proposal.pricing.sync" } });
    assert.equal(logs.length, 2, "KP182_PRICE_AUDIT_MISSING");
    assert.ok(logs.every(log => log.actorId === actor.id && log.actorType === "user"));
    completed.push(fixture.scenario.name);
  }

  const unchangedAfterReject = async (context: ProposalPricingContext, projection: ProposalPricingProjection, expected: RegExp) => {
    const before = await commercialSnapshot(tx, first);
    await assert.rejects(applyProjectionInTransaction(tx, context, projection), expected);
    assert.deepEqual(await commercialSnapshot(tx, first), before, "KP182_REJECTED_SAVE_WROTE_DATA");
  };
  await tx.project.update({ where: { id: first.context.project.id }, data: { stage: "CONTRACT" } });
  await unchangedAfterReject(first.context, first.projection, /Лид/);
  await tx.project.update({ where: { id: first.context.project.id }, data: { stage: "LEAD" } });
  await applyProjectionInTransaction(tx, first.context, first.projection);
  await assertPrices(tx, first);
  await unchangedAfterReject({ ...first.context, proposalId: fixtures[1].context.proposalId }, first.projection, /Лид/);
  await unchangedAfterReject({ ...first.context, actor: { ...actor, roles: ["ENGINEER"] } }, first.projection, /прав/);
  await unchangedAfterReject(first.context, { ...first.projection, items: first.projection.items.map((item, index) => index ? item : { ...item, quantity: item.quantity + 1 }) }, /Состав/);

  // Настоящие Product UPDATE проходят; следующий Project UPDATE падает на реальном CHECK.
  // SAVEPOINT обязан вернуть обе цены и аудит, а внешний runner затем откатывает весь сценарий.
  const beforeFailure = await commercialSnapshot(tx, first);
  let productWritesBeforeFailure = 0, constraintFailure = false;
  const observedTx: Parameters<typeof applyProjectionInTransaction>[0] = {
    $queryRaw: tx.$queryRaw.bind(tx), project: tx.project, changeLog: tx.changeLog,
    product: new Proxy(tx.product, { get(delegate, key) {
      if (key === "updateMany") return async (args: Prisma.ProductUpdateManyArgs) => {
        const result = await delegate.updateMany(args); productWritesBeforeFailure += result.count; return result;
      };
      return Reflect.get(delegate, key);
    } }),
  };
  const invalid: ProposalPricingProjection = { ...first.projection,
    items: first.projection.items.map(item => ({ ...item, initialPrice: new Prisma.Decimal("42.42"), expectedPrice: new Prisma.Decimal("40.00") })),
    project: { ...first.projection.project, servicesTotal: new Prisma.Decimal("1"), delivery: new Prisma.Decimal("1"), unloading: null, installation: null } };
  await tx.$executeRawUnsafe("SAVEPOINT kp182_pricing_constraint_failure");
  try { await applyProjectionInTransaction(observedTx, first.context, invalid); }
  catch (error) {
    const diagnostic = JSON.stringify({ message: error instanceof Error ? error.message : undefined,
      meta: typeof error === "object" && error !== null && "meta" in error ? error.meta : undefined });
    constraintFailure = /Project_services_mode_check/.test(diagnostic);
  }
  finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT kp182_pricing_constraint_failure");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT kp182_pricing_constraint_failure");
  }
  assert.equal(constraintFailure, true, "KP182_REAL_SERVICE_CHECK_FAILURE_REQUIRED");
  assert.equal(productWritesBeforeFailure, first.context.items.length, "KP182_PARTIAL_PRODUCT_WRITES_NOT_OBSERVED");
  assert.deepEqual(await commercialSnapshot(tx, first), beforeFailure, "KP182_PARTIAL_PRICING_ROLLBACK_FAILED");
  assert.deepEqual(await historySnapshot(tx), history, "KP182_GUARD_OR_ROLLBACK_CHANGED_HISTORY");

  return { cases: completed, realDecimalReadback: true, fixedRateFromPostgres: true, sameProjectionRepeated: true,
    historicalFactTables: [...historyTables], syntheticSettledPercentageAndPayroll: true, syntheticPayment: true,
    databaseLeadGuard: true, restoredLeadEditable: true, foreignProposalRejected: true, roleAndQuantityGuards: true,
    realCheckAfterProductWrites: true, partialWriteSavepointRollback: true, outerCommit: "forbidden",
    scope: "pricing adapter only; orchestration181, API operation idempotency, concurrency and staging are not tested" };
}
