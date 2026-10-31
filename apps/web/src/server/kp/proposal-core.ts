import type { CommercialProposal, Prisma, Project } from "@prisma/client";
import { initializeSignature, readSignatureDefaults } from './signature-defaults';
import { MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";
import type { DomainActor } from "@/server/actor";
import { createProjectInTransaction } from "@/server/projects/core";
import { lockProjectRow } from "@/server/projects/lock";
import { bindProposalClient, resolveProposalClientInTransaction, type ProposalEnvironment } from "./proposal-client";
import { synchronizeProposalItemsInTransaction, type SynchronizedProposalItem } from "./proposal-item-sync";
import { ProposalWriteError, canonicalProposalJson, createProposalSchema, normalizeProposalState,
  proposalObject, proposalOperationIdentity, proposalText, saveProposalSchema,
  type ProposalState, type ProposalWriteResult } from "./proposal-contract";

export type ProposalPricingContext = {
  actor: DomainActor;
  proposalId: string;
  proposal: CommercialProposal;
  project: Project;
  state: ProposalState;
  items: readonly SynchronizedProposalItem[];
};

/** Денежный hook обязателен: будущий transport не может сохранить неприменённую цену. */
export type ProposalSaveHooks = {
  applyPricing(tx: Prisma.TransactionClient, context: ProposalPricingContext): Promise<void | { changed: boolean }>;
  applyMedia?(tx: Prisma.TransactionClient, context: ProposalPricingContext): Promise<void | { changed: boolean }>;
  pricingFingerprint?: string;
  environment?: ProposalEnvironment;
  now?: () => Date;
};
export type ProposalWriteMutation = {
  result: ProposalWriteResult;
  eventIds: string[];
  changedProducts: { id: string; previousNumbers: string[] }[];
  projectCreated?: Awaited<ReturnType<typeof createProjectInTransaction>>;
};

function authorize(actor: DomainActor, hooks: ProposalSaveHooks) {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) throw new ProposalWriteError("forbidden", "Недостаточно прав");
  if (typeof hooks?.applyPricing !== "function") throw new ProposalWriteError("failure", "Не подключена синхронизация цен КП");
}

async function lockProposalWrites(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
}

async function liveBinding(tx: Prisma.TransactionClient, proposalId: string) {
  const reference = await tx.commercialProposal.findUnique({ where: { id: proposalId }, select: { projectId: true } });
  if (!reference?.projectId) throw new ProposalWriteError("not-found", "КП не связано с действующим проектом");
  await lockProjectRow(tx, reference.projectId);
  await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id = ${proposalId} FOR UPDATE`;
  const proposal = await tx.commercialProposal.findUnique({ where: { id: proposalId } });
  const project = await tx.project.findUnique({ where: { id: reference.projectId } });
  if (!proposal || proposal.deletedAt || !project || project.deletedAt || proposal.projectId !== project.id)
    throw new ProposalWriteError("not-found", "КП или проект недоступны");
  return { proposal, project };
}

async function readReceipt(tx: Prisma.TransactionClient, actor: DomainActor,
  identity: { receiptId: string; fingerprint: string }): Promise<ProposalWriteMutation | null> {
  const receipt = await tx.changeLog.findUnique({ where: { id: identity.receiptId } });
  if (!receipt) return null;
  const value = proposalObject(receipt.newValue ?? undefined);
  if (receipt.actorId !== actor.id || receipt.entity !== "commercialProposal" || receipt.action !== "kp.write.receipt" ||
    value.fingerprint !== identity.fingerprint)
    throw new ProposalWriteError("validation", "Идентификатор операции уже использован");
  const saved = proposalObject(value.result);
  if (typeof saved.proposalId !== "string" || receipt.entityId !== saved.proposalId ||
    typeof saved.projectId !== "string" || typeof saved.revision !== "number" || !Array.isArray(saved.items))
    throw new ProposalWriteError("failure", "Повреждён результат сохранения КП");
  const binding = await liveBinding(tx, saved.proposalId);
  if (binding.project.id !== saved.projectId)
    throw new ProposalWriteError("not-found", "Привязка КП к проекту изменилась");
  // Уже подтверждённый ответ допустим после смены этапа; новых записей нет.
  return { result: { ...saved, repeated: true } as unknown as ProposalWriteResult, eventIds: [], changedProducts: [] };
}

function projectValues(state: ProposalState, address: string | null | undefined) {
  const order = proposalObject(state.order);
  return {
    title: proposalText(order.project).trim() || "Коммерческое предложение",
    address: address === undefined ? proposalText(order.address).trim() || null : address?.trim() || null,
  };
}

function canonicalState(state: ProposalState, project: { number: string; address: string | null }): ProposalState {
  return { ...state, order: { ...proposalObject(state.order), number: project.number, address: project.address } };
}

async function recordProposalMutation(tx: Prisma.TransactionClient, actor: DomainActor,
  identity: { receiptId: string; fingerprint: string }, result: ProposalWriteResult,
  action: "create" | "update", oldRevision: number | null) {
  const eventIds: string[] = [];
  if (!result.noOp) {
    await tx.changeLog.create({ data: {
      actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "commercialProposal", entityId: result.proposalId, action,
      oldValue: { revision: oldRevision },
      newValue: { revision: result.revision, projectId: result.projectId, itemIds: result.items.map(item => item.id) },
    } });
    const event = await tx.domainEvent.create({ data: {
      type: action === "create" ? "kp.created" : "kp.updated", actor: actor.id,
      payload: { proposalId: result.proposalId, projectId: result.projectId, revision: result.revision },
    } });
    eventIds.push(event.id);
  }
  // No-op тоже фиксирует исходный ответ: последующий replay не станет новой записью.
  await tx.changeLog.create({ data: {
    id: identity.receiptId, actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "commercialProposal", entityId: result.proposalId, action: "kp.write.receipt",
    newValue: { fingerprint: identity.fingerprint, result } as unknown as Prisma.InputJsonValue,
  } });
  return eventIds;
}

/** Только внутри общей mutation transaction. Никаких уведомлений до commit. */
export async function createProposalInTransaction(tx: Prisma.TransactionClient, actor: DomainActor,
  input: unknown, hooks: ProposalSaveHooks): Promise<ProposalWriteMutation> {
  authorize(actor, hooks);
  const parsed = createProposalSchema.safeParse(input);
  if (!parsed.success) throw new ProposalWriteError("validation", parsed.error.issues[0]?.message ?? "Некорректное КП");
  const data = parsed.data;
  const identity = proposalOperationIdentity(actor.id, data.operationId, { kind: "create", ...data }, hooks.pricingFingerprint);
  await lockProposalWrites(tx);
  const replay = await readReceipt(tx, actor, identity);
  if (replay) return replay;
  const source = initializeSignature(normalizeProposalState(data.state), (await readSignatureDefaults(tx)).values);
  const { client, isTemporary } = await resolveProposalClientInTransaction(tx, actor, data, source, undefined, hooks.environment);
  const initial = projectValues(source, data.address);
  const projectCreated = await createProjectInTransaction(tx, actor, {
    title: initial.title, clientId: client.id, address: initial.address ?? undefined,
    ...(hasRole(actor.roles, "MANAGER") ? { managerId: actor.id } : {}),
  });
  const { project } = projectCreated;
  const values = projectValues(source, data.address);
  if (project.title !== values.title)
    Object.assign(project, await tx.project.update({ where: { id: project.id }, data: { title: values.title } }));
  const state = canonicalState(bindProposalClient(source, client, isTemporary), project);
  const proposal = await tx.commercialProposal.create({ data: {
    projectId: project.id, clientId: client.id, state, createdById: actor.id,
  } });
  const sync = await synchronizeProposalItemsInTransaction(tx, actor, { id: proposal.id, projectId: project.id }, project,
    state.items, hooks.now?.() ?? new Date());
  const context = { actor, proposalId: proposal.id, proposal, project, state, items: sync.items };
  await hooks.applyPricing(tx, context);
  await hooks.applyMedia?.(tx, context);
  const result: ProposalWriteResult = {
    ok: true, proposalId: proposal.id, projectId: project.id, number: project.number,
    revision: proposal.revision, state,
    items: sync.items.map(({ id, productId, number }) => ({ id, productId, number })), noOp: false,
  };
  const eventIds = await recordProposalMutation(tx, actor, identity, result, "create", null);
  return { result, projectCreated, eventIds, changedProducts: [...sync.previousNumbers].map(([id, number]) => ({ id, previousNumbers: [number] })) };
}

/** Снимок КП полностью восстанавливает коммерческие данные, даже при том же JSON. */
export async function saveProposalInTransaction(tx: Prisma.TransactionClient, actor: DomainActor,
  input: unknown, hooks: ProposalSaveHooks): Promise<ProposalWriteMutation> {
  authorize(actor, hooks);
  const parsed = saveProposalSchema.safeParse(input);
  if (!parsed.success) throw new ProposalWriteError("validation", parsed.error.issues[0]?.message ?? "Некорректное КП");
  const data = parsed.data;
  const identity = proposalOperationIdentity(actor.id, data.operationId, { kind: "save", ...data }, hooks.pricingFingerprint);
  await lockProposalWrites(tx);
  const { proposal, project } = await liveBinding(tx, data.proposalId);
  const replay = await readReceipt(tx, actor, identity);
  if (replay) return replay;
  if (project.stage !== "LEAD") throw new ProposalWriteError("locked", "КП можно сохранять только в проекте «Лид»");
  if (proposal.revision !== data.expectedRevision)
    throw new ProposalWriteError("conflict", "КП изменено другим пользователем — обновите редактор");
  const source = normalizeProposalState(data.state);
  const selection = await resolveProposalClientInTransaction(tx, actor, data, source, proposal.clientId ?? project.clientId, hooks.environment, proposal.state);
  const values = projectValues(source, data.address);
  const state = canonicalState(bindProposalClient(source, selection.client, selection.isTemporary), { ...project, ...values });
  const projectChanged = project.title !== values.title || project.address !== values.address || project.clientId !== selection.client.id;
  if (projectChanged) {
    await tx.project.update({ where: { id: project.id }, data: { ...values, clientId: selection.client.id } });
    await tx.changeLog.create({ data: {
      actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "project", entityId: project.id, action: "kp.synchronize",
      oldValue: { title: project.title, address: project.address, clientId: project.clientId },
      newValue: { ...values, clientId: selection.client.id, proposalId: proposal.id },
    } });
  }
  const sync = await synchronizeProposalItemsInTransaction(tx, actor, { id: proposal.id, projectId: project.id }, project,
    state.items, hooks.now?.() ?? new Date());
  const context = { actor, proposalId: proposal.id, proposal,
    project: { ...project, ...values, clientId: selection.client.id }, state, items: sync.items };
  const pricing = await hooks.applyPricing(tx, context);
  const media = await hooks.applyMedia?.(tx, context);
  const changed = projectChanged || selection.changed || sync.changed || pricing?.changed === true || media?.changed === true ||
    proposal.clientId !== selection.client.id || canonicalProposalJson(proposal.state) !== canonicalProposalJson(state);
  const revision = proposal.revision + (changed ? 1 : 0);
  if (changed) {
    const saved = await tx.commercialProposal.updateMany({ where: {
      id: proposal.id, revision: data.expectedRevision, projectId: project.id, deletedAt: null,
    }, data: { state, clientId: selection.client.id, revision } });
    if (saved.count !== 1) throw new ProposalWriteError("conflict", "КП изменено другим пользователем");
  }
  const result: ProposalWriteResult = {
    ok: true, proposalId: proposal.id, projectId: project.id, number: project.number, revision, state,
    items: sync.items.map(({ id, productId, number }) => ({ id, productId, number })), noOp: !changed,
  };
  const eventIds = await recordProposalMutation(tx, actor, identity, result, "update", proposal.revision);
  return { result, eventIds, changedProducts: [...sync.previousNumbers].map(([id, number]) => ({ id, previousNumbers: [number] })) };
}
