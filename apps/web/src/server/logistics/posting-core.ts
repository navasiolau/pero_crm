import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { UploadError } from "@/server/files/upload-result";
import { prepareLogisticsPayment } from "./prepare-payment";
import { createPaymentInTransaction, type PreparedPayment } from "@/server/payments/transaction";
import { readCashBalance, readOrgBalance } from "@/server/payroll/cash-core";
import { allocateLogisticsMoney } from "./allocation";
import { logisticsManifestInclude, lockLogisticsTrip, requireLogisticsActor, validateTripManifest,
  replaceTripManifestInTransaction, type LogisticsManifestRecord, type LogisticsTransaction } from "./core";
import { shipmentLineKey, type LogisticsTripManifestInput } from "./contracts";
import { logisticsPostingSchema, type LogisticsPostingData, type LogisticsPostingResult } from "./money-contracts";

type PreparationDatabase = Pick<Prisma.TransactionClient, "user" | "project" | "cashAccount" | "logisticsTrip" | "logisticsPosting">;
export type LogisticsMoneyDependencies = {
  db: PreparationDatabase; transaction: LogisticsTransaction; getRate?: Parameters<typeof prepareLogisticsPayment>[3];
};
type PostingMode = "post" | "correct";
export type LogisticsPostingCoreResult = LogisticsPostingResult & { eventId: string | null; projectIds: string[] };

function failure(message: string, conflict = false): never {
  throw new UploadError(conflict ? "LOGISTICS_REVISION_CONFLICT" : "LOGISTICS_PAYMENT_INVALID", conflict ? 409 : 422,
    conflict ? "persist" : "validation", message, conflict ? "conflict" : "validation");
}
export function logisticsPostingFingerprint(actorId: string, mode: PostingMode, data: LogisticsPostingData) {
  const manifest = data.manifest ? { date: data.manifest.date, comment: data.manifest.comment,
    shares: [...data.manifest.shares].sort((a, b) => a.projectId.localeCompare(b.projectId)),
    lines: [...data.manifest.lines].sort((a, b) => shipmentLineKey(a).localeCompare(shipmentLineKey(b))),
    ...(data.manifest.ttnNotRequired !== undefined ? { ttnNotRequired: data.manifest.ttnNotRequired } : {}) } : null;
  return createHash("sha256").update(JSON.stringify({ actorId, mode, tripId: data.tripId, expectedRevision: data.expectedRevision,
    amount: new Prisma.Decimal(data.amount).toFixed(2), currency: data.currency, cashAccountId: data.cashAccountId,
    documentIds: [...data.documentIds].sort(), rate: data.rate ?? null, rateDate: data.rateDate ?? null, manifest })).digest("hex");
}
async function readReceipt(actorId: string, fingerprint: string, data: LogisticsPostingData,
  db: Pick<Prisma.TransactionClient, "logisticsPosting">): Promise<LogisticsPostingCoreResult | null> {
  const row = await db.logisticsPosting.findUnique({ where: { clientMutationId: data.clientMutationId },
    include: { allocations: { select: { projectId: true } } } });
  if (!row) return null;
  if (row.actorId !== actorId || row.requestFingerprint !== fingerprint)
    failure("Идентификатор проведения уже использован с другими данными", true);
  return { tripId: row.tripId, postingId: row.id, revision: row.tripRevision, repeated: true, eventId: null,
    projectIds: row.allocations.map(allocation => allocation.projectId) };
}
function manifestOf(row: LogisticsManifestRecord): LogisticsTripManifestInput {
  return { date: row.date.toISOString().slice(0, 10), comment: row.comment, ttnNotRequired: row.ttnNotRequired,
    shares: row.shares.map(({ projectId, percentBps }) => ({ projectId, percentBps })),
    lines: row.lines.map(line => line.kind === "PRODUCT"
      ? { projectId: line.projectId, kind: "PRODUCT" as const, productId: line.productId!, quantity: line.quantity.toNumber() }
      : { projectId: line.projectId, kind: "MATERIAL" as const, materialId: line.materialId!, quantity: line.quantity.toNumber() }) };
}

/** Сеть вызывается один раз перед короткой общей денежной транзакцией. */
export async function createLogisticsPostingCore(actorId: string | null | undefined, input: unknown, mode: PostingMode,
  dependencies: LogisticsMoneyDependencies): Promise<LogisticsPostingCoreResult> {
  const parsed = logisticsPostingSchema.safeParse(input);
  if (!parsed.success) failure(parsed.error.issues[0]?.message ?? "Проверьте стоимость и кассу рейса");
  const data = parsed.data;
  const actor = await requireLogisticsActor(actorId, dependencies.db);
  const fingerprint = logisticsPostingFingerprint(actor.id, mode, data);
  const receipt = await readReceipt(actor.id, fingerprint, data, dependencies.db);
  if (receipt) return receipt;
  const trip = await dependencies.db.logisticsTrip.findUnique({ where: { id: data.tripId }, select: { date: true } });
  if (!trip) failure("Рейс не найден");
  const date = data.manifest?.date ?? trip.date.toISOString().slice(0, 10);
  const prepared = await prepareLogisticsPayment(data, date, dependencies.db, dependencies.getRate);
  return dependencies.transaction(tx => postLogisticsInTransaction(actor.id, data, mode, prepared, tx));
}

/** Вызывать только под общей денежной блокировкой, затем блокировкой рейса. */
export async function postLogisticsInTransaction(actorId: string, input: LogisticsPostingData, mode: PostingMode,
  prepared: PreparedPayment, tx: Prisma.TransactionClient): Promise<LogisticsPostingCoreResult> {
  const data = logisticsPostingSchema.parse(input), actor = await requireLogisticsActor(actorId, tx);
  await lockLogisticsTrip(tx, data.tripId);
  const fingerprint = logisticsPostingFingerprint(actor.id, mode, data);
  const receipt = await readReceipt(actor.id, fingerprint, data, tx);
  if (receipt) return receipt;
  const previous = await tx.logisticsTrip.findUnique({ where: { id: data.tripId }, include: logisticsManifestInclude });
  if (!previous) failure("Рейс не найден");
  if (previous.revision !== data.expectedRevision) failure("Рейс уже изменён. Откройте актуальную запись", true);
  const current = await tx.logisticsPosting.findFirst({ where: { tripId: data.tripId, status: "ACTIVE" },
    include: { allocations: { select: { projectId: true } } } });
  if (mode === "post" && current) failure("Рейс уже оплачен. Используйте исправление расхода", true);
  if (mode === "correct" && !current) failure("Рейс ещё не оплачен — сначала проведите расход", true);
  const manifest = { ...(data.manifest ?? manifestOf(previous)), ttnNotRequired: data.manifest?.ttnNotRequired ?? previous.ttnNotRequired };
  const replacement = data.manifest ? await validateTripManifest(tx, manifest, previous, actor) : null;
  const [projects, account, documents] = await Promise.all([
    tx.project.findMany({ where: { id: { in: manifest.shares.map(share => share.projectId) }, deletedAt: null },
      select: { id: true, number: true, currency: true } }),
    tx.cashAccount.findUnique({ where: { id: data.cashAccountId }, select: { id: true, name: true, currency: true, active: true } }),
    tx.logisticsDocument.findMany({ where: { id: { in: data.documentIds }, tripId: data.tripId, state: "READY", stage: { in: ["ISSUED", "SIGNED"] } },
      select: { id: true, contentHash: true, stage: true, ttnNumber: true } }),
  ]);
  if (projects.length !== manifest.shares.length) failure("Один из проектов не найден или находится в корзине");
  for (const project of projects) assertProjectMoneyCurrency(project.currency);
  if (!account?.active || account.currency !== data.currency || prepared.account.id !== account.id ||
      prepared.project || prepared.articleId !== null ||
      !new Prisma.Decimal(data.amount).eq(prepared.amount) || (data.currency === "BYN" && prepared.rate !== 1) ||
      prepared.paidAt.toISOString().slice(0, 10) !== manifest.date)
    failure("Касса или дата изменились — обновите рейс");
  if (documents.length !== data.documentIds.length || (!manifest.ttnNotRequired && !documents.length))
    failure("Для списания нужна сохранённая ТТН этого рейса с одной печатью либо отметка «ТТН не требуется»");
  const split = allocateLogisticsMoney(data.amount, manifest.shares, new Prisma.Decimal(prepared.rate).toFixed(6));

  // Внешний writer всегда откатывает всю tx при любом последующем отказе.
  if (current) await tx.logisticsPosting.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
  const [cash, org] = await Promise.all([
    readCashBalance(tx, account.id), readOrgBalance(tx, "1.000000", new Prisma.Decimal(split.bynAmount).negated().toFixed(2)),
  ]);
  if (cash.lt(split.amount)) failure("Недостаточно средств в выбранной кассе");
  if (org.lt(0)) failure("Недостаточно средств на балансе организации");
  if (current && current.cashAccountId !== account.id && (await readCashBalance(tx, current.cashAccountId)).lt(0))
    failure("Исправление оставит отрицательный остаток прежней кассы");
  const changed = await tx.logisticsTrip.updateMany({ where: { id: previous.id, revision: data.expectedRevision },
    data: { revision: { increment: 1 }, updatedById: actor.id,
      ...(replacement ? { date: new Date(`${manifest.date}T00:00:00.000Z`), comment: manifest.comment, ttnNotRequired: manifest.ttnNotRequired } : {}) } });
  if (changed.count !== 1) failure("Рейс уже изменён. Откройте актуальную запись", true);
  if (replacement) await replaceTripManifestInTransaction(tx, previous.id, replacement, previous);
  const revision = previous.revision + 1, postingId = randomUUID();
  const snapshot = { ...manifest, lines: replacement?.snapshots ?? previous.lines.map(line => ({ projectId: line.projectId, kind: line.kind,
    productId: line.productId, materialId: line.materialId, nameSnapshot: line.nameSnapshot, numberSnapshot: line.numberSnapshot,
    unitSnapshot: line.unitSnapshot, quantity: line.quantity.toNumber() })) };
  await tx.logisticsPosting.create({ data: { id: postingId, tripId: previous.id, tripRevision: revision,
    clientMutationId: data.clientMutationId, requestFingerprint: fingerprint, actorId: actor.id, actorNameSnapshot: actor.name,
    amount: split.amount, bynAmount: split.bynAmount, currency: data.currency, cashAccountId: account.id,
    cashAccountNameSnapshot: account.name, expenseArticleId: null,
    rate: split.rate, rateDate: prepared.rateDate, paidAt: prepared.paidAt, manifestSnapshot: snapshot, ttnNotRequired: manifest.ttnNotRequired,
  } });
  await tx.logisticsPostingDocument.createMany({ data: documents.map(document => ({ postingId, tripId: previous.id, documentId: document.id })) });
  for (const allocation of split.allocations) {
    const project = projects.find(row => row.id === allocation.projectId)!;
    const saved = await tx.logisticsPostingAllocation.create({ data: { id: randomUUID(), postingId, ...allocation, projectNumberSnapshot: project.number } });
    if (saved.amount.isZero()) continue;
    const partPrepared = { ...prepared, account, project, amount: saved.amount.toNumber(), bynAmount: saved.bynAmount.toNumber() };
    await createPaymentInTransaction({ ...actor, source: "web" }, { direction: "EXPENSE", projectId: project.id,
      amount: partPrepared.amount, currency: data.currency, cashAccountId: account.id,
      comment: manifest.comment || `Логистика · ${manifest.date}` }, partPrepared, tx, { logisticsAllocationId: saved.id });
  }
  const event = await tx.domainEvent.create({ data: { type: current ? "logistics.trip.corrected" : "logistics.trip.posted", actor: actor.id,
    payload: { tripId: previous.id, postingId, previousPostingId: current?.id ?? null, revision, amount: split.amount,
      currency: data.currency, bynAmount: split.bynAmount, projectIds: projects.map(project => project.id) } } });
  await tx.changeLog.create({ data: { id: `logistics-posting:${data.clientMutationId}`, actorType: "user", actorId: actor.id,
    actorName: actor.name, entity: "logisticsPosting", entityId: postingId, action: mode,
    ...(current ? { oldValue: { postingId: current.id, amount: current.amount.toFixed(2), currency: current.currency,
      cashAccountId: current.cashAccountId, bynAmount: current.bynAmount.toFixed(2) } } : {}),
    newValue: { tripId: previous.id, revision, amount: split.amount, currency: data.currency, bynAmount: split.bynAmount,
      cashAccountId: account.id, allocations: split.allocations, documents, eventId: event.id } } });
  return { tripId: previous.id, revision, postingId, repeated: false, eventId: event.id,
    projectIds: [...new Set([...projects.map(project => project.id), ...(current?.allocations.map(row => row.projectId) ?? [])])] };
}
