import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProposalDocument } from "@pero/kp-template";
import { prisma } from "@/lib/prisma";
import { clientSchema, createClientInTransaction } from "@/server/clients/core";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { deliverProjectCreated } from "@/server/projects/core";
import { dispatchEvent } from "@/server/plugins/events";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { revalidatePath } from "next/cache";
import { apiFailure, apiId, apiOperationId, parseApi, type KpApiContext } from "./api-contract";
import { proposalClientLabel, proposalClientSnapshot, proposalTemporaryClientId } from "./proposal-client";
import { createProposalInTransaction, saveProposalInTransaction, type ProposalSaveHooks, type ProposalWriteMutation } from "./proposal-core";
import { normalizeProposalState, proposalObject, type ProposalState } from "./proposal-contract";
import { projectProposalPricing } from "./pricing";
import { applyProjectionInTransaction } from "./pricing-persistence";
import { fixedProposalRate, proposalCurrency, type ProposalFixedRate } from "./pricing-contract";
import { createProposalMediaHooks } from "./media-product-sync";
import { prepareProposalProductMedia, uploadProposalImage, readProposalMedia } from "./media-core";
import { createPrismaProposalMediaRepository } from "./media-repository";
import { createProposalMediaS3Storage } from "./media-storage";
import type { PreparedProductMedia } from "./media-contract";
import { apiDigest, apiReceiptId, kpJson, readApiReceipt, runApiCommand, writeApiReceipt } from "./api-operation";
import { fetchKpNbrbRate, moscowDate, proposalSourceDate, rateDto, storedKpRate } from "./api-rates";
import type { KpApiScope } from "@/lib/kp-api-scopes";

export const liveApiProposalWhere = { deletedAt: null, OR: [{ projectId: null }, { project: { deletedAt: null } }] } satisfies Prisma.CommercialProposalWhereInput;
const documentInclude = { project: { select: { id: true, number: true, stage: true, deletedAt: true } },
  client: { select: { id: true, name: true, lastName: true, middleName: true } } } satisfies Prisma.CommercialProposalInclude;
type DocumentRow = Prisma.CommercialProposalGetPayload<{ include: typeof documentInclude }>;
type DocumentDb = Pick<PrismaClient, "commercialProposal">;
export function documentDto(row: DocumentRow): ProposalDocument & { sourceDate: string | null } {
  const rate = storedKpRate(row);
  return { id: row.id, revision: row.revision, state: row.state as ProposalDocument["state"], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    project: row.project ? { id: row.project.id, number: row.project.number, stage: row.project.stage } : null,
    client: row.client ? { id: row.client.id, label: proposalClientLabel(row.client) } : null,
    canEdit: row.project?.stage === "LEAD" && row.project.deletedAt === null,
    fx: rate ? rateDto(rate) : null, sourceDate: proposalSourceDate(row.state) };
}
export async function loadApiDocument(db: DocumentDb, proposalId: string) {
  const row = await db.commercialProposal.findFirst({ where: { AND: [liveApiProposalWhere, { id: proposalId }] }, include: documentInclude });
  if (!row) return apiFailure("KP_NOT_FOUND", 404, "КП недоступно");
  return row;
}
export async function listApiDocuments(context: KpApiContext, input: Record<string, unknown>) {
  await context.authorize("kp:read");
  const query = parseApi(z.object({ q: z.string().trim().max(200).optional(), cursor: apiId.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict(), input);
  const rows = await prisma.commercialProposal.findMany({ where: { AND: [liveApiProposalWhere,
    ...(query.q ? [{ OR: [{ sourceNumber: { contains: query.q, mode: "insensitive" as const } }, { project: { OR: [
      { title: { contains: query.q, mode: "insensitive" as const } }, { number: { contains: query.q } }] } },
      { state: { path: ["order", "project"], string_contains: query.q, mode: "insensitive" as const } },
      { state: { path: ["client", "name"], string_contains: query.q, mode: "insensitive" as const } },
      { client: { OR: [{ name: { contains: query.q, mode: "insensitive" as const } }, { lastName: { contains: query.q, mode: "insensitive" as const } }] } }] }] : [])] },
    include: documentInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  const documents = rows.slice(0, query.limit).map(row => {
    const dto = documentDto(row), order = proposalObject(proposalObject(row.state).order);
    const sourceClient = proposalObject(proposalObject(row.state).client);
    return { id: dto.id, revision: dto.revision, project: dto.project, client: dto.client, createdAt: dto.createdAt, updatedAt: dto.updatedAt,
      currency: row.currency,
      number: row.project?.number ?? row.sourceNumber ?? (typeof order.number === "string" || typeof order.number === "number" ? String(order.number) : null),
      printedClientName: typeof sourceClient.name === "string" && sourceClient.name.trim() ? sourceClient.name : null,
      name: typeof order.project === "string" && order.project.trim() ? order.project : `КП №${row.project?.number ?? row.sourceNumber ?? row.id}` };
  });
  return { documents, nextCursor: rows.length > query.limit ? documents.at(-1)!.id : null };
}

/** Авторизация ключа входит в те же reserve/publish tx, что и ledger №183. */
export function mediaDependencies(context: KpApiContext, scope: KpApiScope, command?: { operationId: string; proposalId: string; fingerprint?: string; upload?: boolean }) {
  let uploadJobId: string | undefined;
  const database = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") { const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; }
    return async <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => withMutationTransaction(async tx => {
      if (typeof run !== "function") return apiFailure("KP_MEDIA_TRANSACTION_INVALID", 500, "Не удалось начать загрузку");
      context.actor = await context.authorize(scope, tx);
      const value = await run(tx);
      if (command) {
        const candidate = value && typeof value === "object" && "plan" in value ? value.plan : null;
        if (candidate && typeof candidate === "object" && "jobId" in candidate && typeof candidate.jobId === "string") {
          if (command.upload && "kind" in candidate && candidate.kind === "UPLOAD_MEDIA") uploadJobId = candidate.jobId;
          const auditId = `kp.api.media:${apiDigest({ principal: apiReceiptId(context, command.operationId), jobId: candidate.jobId })}`;
          if (!await tx.changeLog.findUnique({ where: { id: auditId } })) await tx.changeLog.create({ data: {
            id: auditId, actorType: "user", actorId: context.actor.id, actorName: context.actor.name, source: context.binding.source,
            entity: "commercialProposal", entityId: command.proposalId, action: "kp.api.media",
            newValue: kpJson({ operationId: command.operationId, tokenId: context.binding.tokenId ?? null, jobId: candidate.jobId }) } });
        }
        if (command.upload && command.fingerprint && uploadJobId) {
          const uploaded = await tx.proposalJob.findFirst({ where: { id: uploadJobId, proposalId: command.proposalId, createdById: context.actor.id, kind: "UPLOAD_MEDIA", state: "SUCCEEDED" },
            select: { payload: true } });
          const plan = uploaded ? proposalObject(uploaded.payload) : null;
          if (plan && typeof plan.mediaId === "string" && !await readApiReceipt(tx, context, command.operationId, command.fingerprint, tx))
            await writeApiReceipt(tx, context, { operationId: command.operationId, kind: "upload", scope, fingerprint: command.fingerprint, entityId: command.proposalId },
              { mediaId: plan.mediaId, reference: `kp-media:${plan.mediaId}` });
        }
      }
      return value;
    });
  } });
  return { repository: createPrismaProposalMediaRepository(database), storage: createProposalMediaS3Storage(), authorize: async () => { await context.authorize(scope); } };
}

async function chooseRate(context: KpApiContext, state: ProposalState, input: Record<string, unknown>, existing?: DocumentRow) {
  const currency = pricingInput(() => proposalCurrency(state.currency)), old = existing ? storedKpRate(existing) : null;
  if (input.fx && typeof input.fx === "object") {
    const fx = input.fx as { currency: string; rate: string; date: string; source: string };
    const selected = pricingInput(() => fixedProposalRate({ currency: fx.currency, value: fx.rate, date: fx.date, source: fx.source }, currency));
    if (selected.source === "NBRB" && (!old || apiDigest(rateDto(old)) !== apiDigest(rateDto(selected)))) {
      const actual = await fetchKpNbrbRate(context, { currency, date: selected.date });
      if (!actual.value.eq(selected.value)) return apiFailure("KP_RATE_CHANGED", 409, "Курс НБРБ не совпал. Запросите курс заново или задайте ручной");
    }
    return selected;
  }
  if (old) {
    if (old.currency !== currency) return apiFailure("KP_RATE_REQUIRED", 400, "Укажите фиксированный курс выбранной валюты");
    return old;
  }
  if (existing && existing.rate !== null) return apiFailure("KP_RATE_REQUIRED", 400, "Укажите фиксированный курс выбранной валюты");
  const date = proposalSourceDate(state);
  if (!date) return apiFailure("KP_DATE_REQUIRED", 400, "Укажите дату КП");
  return fetchKpNbrbRate(context, { currency, date });
}
const moneyEqual = (left: unknown, right: unknown) => left == null || right == null ? left == null && right == null : new Prisma.Decimal(String(left)).eq(String(right));
function pricingInput<T>(run: () => T): T {
  try { return run(); }
  catch (error) { return apiFailure("KP_PRICING_INVALID", 400, error instanceof Error ? error.message : "Проверьте цены и курс КП"); }
}
export function createApiSaveHooks(fx: ProposalFixedRate, preparedCopies?: PreparedProductMedia): ProposalSaveHooks {
  const media = createProposalMediaHooks({ storage: createProposalMediaS3Storage(), preparedCopies });
  return {
    pricingFingerprint: apiDigest(rateDto(fx)), applyMedia: media.applyMedia,
    async applyPricing(tx, context) {
      const projection = pricingInput(() => projectProposalPricing(context.state, fx));
      const currentProject = await tx.project.findUniqueOrThrow({ where: { id: context.project.id } });
      const products = await tx.product.findMany({ where: { projectId: context.project.id, deletedAt: null } });
      const links = new Map(context.items.map(item => [item.id, item]));
      if (products.length !== projection.items.length || context.items.length !== projection.items.length) return apiFailure("KP_COMPOSITION_CHANGED", 409, "Изменился состав КП");
      const changedPools: string[] = [];
      let productsChanged = false;
      for (const item of projection.items) {
        const link = links.get(item.id), actual = products.find(product => product.id === link?.productId);
        if (!actual || actual.quantity !== item.quantity) return apiFailure("KP_COMPOSITION_CHANGED", 409, "Изменился состав КП");
        if (!moneyEqual(actual.expectedPrice, item.expectedPrice) || link?.previousQuantity != null && link.previousQuantity !== item.quantity) changedPools.push(actual.id);
        if (!moneyEqual(actual.initialPrice, item.initialPrice) || !moneyEqual(actual.expectedPrice, item.expectedPrice) || actual.initialPriceCaptureEligible) productsChanged = true;
      }
      const projectChanged = Object.entries(projection.project).some(([field, value]) => field === "currency"
        ? currentProject.currency !== value : !moneyEqual(currentProject[field as keyof typeof currentProject], value));
      const oldRate = storedKpRate(context.proposal), rateChanged = !oldRate || apiDigest(rateDto(oldRate)) !== apiDigest(rateDto(fx));
      if (productsChanged || projectChanged) {
        await applyProjectionInTransaction(tx, context, projection);
      }
      if (changedPools.length) await tx.productStagePayPool.updateMany({ where: { productId: { in: changedPools }, kind: "ENGINEERING", state: "DRAFT" }, data: { revision: { increment: 1 } } });
      if (rateChanged) await tx.commercialProposal.update({ where: { id: context.proposalId }, data: {
        currency: fx.currency, rate: fx.value, rateDate: new Date(`${fx.date}T00:00:00Z`), rateSource: fx.source } });
      return { changed: productsChanged || projectChanged || rateChanged };
    },
  };
}
export async function afterDocumentMutation(context: KpApiContext, mutation: ProposalWriteMutation) {
  if (mutation.projectCreated) await deliverProjectCreated(context.actor, mutation.projectCreated);
  for (const id of mutation.eventIds) await dispatchEvent(id).catch(() => undefined);
  const products = new Map(mutation.changedProducts.map(item => [item.id, item.previousNumbers]));
  // Pricing/media hooks могут изменить изделие без изменения его текста или номера.
  if (!mutation.result.noOp) for (const item of mutation.result.items) if (!products.has(item.productId)) products.set(item.productId, []);
  for (const [productId, previousNumbers] of products) await revalidateProductPaths(productId, previousNumbers);
  await deliverPostCommit("product-update", mutation.result.proposalId,
    ["/kp", `/kp/${mutation.result.proposalId}`, "/clients", "/projects", `/projects/${mutation.result.projectId}`,
      "/", "/warehouse", "/warehouse/stock", "/warehouse/items", "/finance"]
      .map(path => ({ kind: "cache" as const, run: () => revalidatePath(path) })));
}
export async function saveApiDocument(context: KpApiContext, input: Record<string, unknown>, create: boolean) {
  const operationId = String(input.operationId);
  return runApiCommand({ context, scope: "kp:write", kind: create ? "document.create" : "document.save", operationId, input, transaction: withMutationTransaction,
    prepare: async () => {
      await context.authorize("kp:write");
      let index = 0;
      let state = normalizeProposalState(input.state, () => `kpi_${apiDigest({ actor: context.actor.id, operationId, index: index++ })}`);
      const order = proposalObject(state.order);
      if (create && !order.date) { const date = moscowDate(); state = { ...state, order: { ...order, date: `${date.slice(8)}.${date.slice(5, 7)}.${date.slice(0, 4)}` } }; }
      const existing = create ? undefined : await loadApiDocument(prisma, String(input.proposalId));
      if (existing && (existing.revision !== input.expectedRevision || existing.project?.stage !== "LEAD"))
        return apiFailure("KP_REVISION_CHANGED", 409, "КП изменено или уже недоступно для редактирования");
      if (create && state.items.some(item => item.image || item.image2)) return apiFailure("KP_CREATE_MEDIA_SEQUENCE", 400, "Сначала создайте КП, затем загрузите изображения и сохраните их ссылки");
      const rate = await chooseRate(context, state, input, existing);
      const prepared = create ? undefined : await prepareProposalProductMedia(mediaDependencies(context, "kp:write", { operationId, proposalId: existing!.id }),
        { actorId: context.actor.id, proposalId: existing!.id, expectedRevision: Number(input.expectedRevision), operationId, items: state.items });
      return { state, rate, prepared };
    },
    mutate: async (tx, ready) => {
      if (!ready) return apiFailure("KP_PREPARATION_REQUIRED", 503, "Подготовка КП не подтверждена");
      const { fx: _fx, expectedNumber, ...data } = input; void _fx;
      const command = { ...data, state: ready.state };
      const hooks = createApiSaveHooks(ready.rate, ready.prepared);
      const mutation = create ? await createProposalInTransaction(tx, context.actor, command, hooks) : await saveProposalInTransaction(tx, context.actor, command, hooks);
      if (create && expectedNumber !== undefined && mutation.result.number !== String(expectedNumber)) return apiFailure("KP_NUMBER_CHANGED", 409, "Следующий номер проекта изменился. Обновите ожидаемый номер");
      const row = await loadApiDocument(tx, mutation.result.proposalId), result = documentDto(row);
      return { result, entityId: row.id, afterCommit: () => afterDocumentMutation(context, mutation) };
    },
  });
}
export async function uploadApiMedia(context: KpApiContext, input: Record<string, unknown>) {
  const { operationId, proposalId } = input as { operationId: string; proposalId: string };
  const original = input.original as Buffer, optimized = input.optimized as Buffer | undefined;
  const fingerprint = apiDigest({ kind: "upload", proposalId, expectedRevision: input.expectedRevision, fileName: input.fileName, mimeType: input.mimeType,
    originalHash: createHash("sha256").update(original).digest("hex"), optimizedHash: optimized ? createHash("sha256").update(optimized).digest("hex") : null, optimizedMimeType: input.optimizedMimeType });
  const replay = await readApiReceipt(prisma, context, operationId, fingerprint); if (replay) return replay.result;
  const dependencies = mediaDependencies(context, "kp:media:write", { operationId, proposalId, fingerprint, upload: true });
  const result = await uploadProposalImage(dependencies, { actorId: context.actor.id, proposalId, operationId, expectedRevision: Number(input.expectedRevision),
    original, fileName: String(input.fileName), mimeType: String(input.mimeType ?? ""), ...(optimized ? { optimized, optimizedMimeType: String(input.optimizedMimeType ?? "") } : {}) });
  const receipt = await readApiReceipt(prisma, context, operationId, fingerprint);
  if (!receipt) return apiFailure("KP_UPLOAD_ACK_UNKNOWN", 503, "Загрузка не подтверждена. Проверьте результат по UUID");
  if ((receipt.result as { mediaId?: string }).mediaId !== result.mediaId) return apiFailure("KP_UPLOAD_ACK_UNKNOWN", 503, "Не совпал результат загрузки");
  return receipt.result;
}
export async function readApiMedia(context: KpApiContext, input: Record<string, unknown>) {
  const value = parseApi(z.object({ proposalId: apiId, mediaId: apiId, variant: z.enum(["original", "optimized"]).default("optimized"),
    scope: z.enum(["uploaded", "current", "version"]).default("current"), versionId: apiId.optional() }).strict(), input);
  if ((value.scope === "version") !== Boolean(value.versionId)) return apiFailure("KP_MEDIA_SCOPE_INVALID", 400, "Укажите версию изображения");
  return { ...await readProposalMedia(mediaDependencies(context, "kp:read"), { actorId: context.actor.id, proposalId: value.proposalId, mediaId: value.mediaId,
    variant: value.variant, scope: value.scope === "version" ? { kind: "version", versionId: value.versionId! } : { kind: value.scope } }), disposition: "inline" as const };
}

export async function clientApiDetails(context: KpApiContext, clientId: string) {
  await context.authorize("kp:read");
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return apiFailure("KP_CLIENT_NOT_FOUND", 404, "Клиент не найден");
  const temporaryId = proposalTemporaryClientId();
  const isTemporary = client.id === temporaryId;
  if (isTemporary && (client.name.trim() !== "Временный" || client.lastName?.trim() || client.middleName?.trim())) return apiFailure("KP_TEMP_CLIENT_INVALID", 503, "Служебная карточка КП не прошла проверку");
  return { id: client.id, label: proposalClientLabel(client), phone: client.phone, address: client.address, isTemporary, snapshot: proposalClientSnapshot(client) };
}
export async function listApiClients(context: KpApiContext, input: Record<string, unknown>) {
  await context.authorize("kp:read");
  const query = parseApi(z.object({ q: z.string().trim().max(200).default(""), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict(), input);
  const clients = await prisma.client.findMany({ where: query.q ? { OR: ["name", "lastName", "middleName", "phone"].map(field => ({ [field]: { contains: query.q, mode: "insensitive" } })) } : {},
    select: { id: true, name: true, lastName: true, middleName: true, phone: true, address: true }, orderBy: [{ lastName: "asc" }, { name: "asc" }, { id: "asc" }], take: query.limit });
  return { clients: clients.map(client => ({ id: client.id, label: proposalClientLabel(client), phone: client.phone, address: client.address })) };
}
export async function createApiClient(context: KpApiContext, input: Record<string, unknown>) {
  const command = parseApi(clientSchema.extend({ operationId: apiOperationId }).strict(), input);
  return runApiCommand({ context, scope: "kp:write", kind: "client.create", operationId: command.operationId, input: command, transaction: withMutationTransaction,
    mutate: async tx => {
      const { operationId: _operationId, ...data } = command; void _operationId;
      const created = await createClientInTransaction(tx, context.actor, data);
      if (!created.ok) return apiFailure("KP_CLIENT_INVALID", 400, created.error);
      const client = await tx.client.findUniqueOrThrow({ where: { id: created.id } });
      return { entityId: client.id, result: { id: client.id, label: proposalClientLabel(client), phone: client.phone, address: client.address, isTemporary: false, snapshot: proposalClientSnapshot(client) },
        afterCommit: async () => {
          for (const path of ["/clients", "/projects"]) try { revalidatePath(path); } catch { /* Receipt уже подтверждён. */ }
        } };
    } });
}
