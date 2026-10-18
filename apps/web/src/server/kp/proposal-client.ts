import type { Client, Prisma } from "@prisma/client";
import { clientFields, updateClientInTransaction, type ClientBaseline, type ClientInput } from "@/server/clients/core";
import type { DomainActor } from "@/server/actor";
import { ProposalWriteError, proposalClientSnapshotSchema, proposalObject, type ProposalState, type ProposalClientSnapshotInput } from "./proposal-contract";

export type ProposalClientSelection = {
  clientId?: string;
  clientSnapshot?: ProposalClientSnapshotInput;
};
export type ProposalEnvironment = Readonly<Record<string, string | undefined>>;

export function proposalTemporaryClientId(environment: ProposalEnvironment = process.env): string {
  const value = environment.PERO_KP_TEMP_CLIENT_ID?.trim();
  if (!value) throw new ProposalWriteError("validation", "Не настроен ID служебного клиента КП");
  return value;
}

export function proposalClientSnapshot(client: Client) {
  return {
    id: client.id, name: client.name, lastName: client.lastName, middleName: client.middleName,
    phone: client.phone, email: client.email, address: client.address, comment: client.comment,
    passportNumber: client.passportNumber, passportIssuedBy: client.passportIssuedBy,
  };
}

export function proposalClientLabel(client: Pick<Client, "name" | "lastName" | "middleName">): string {
  return [client.lastName, client.name, client.middleName].filter(Boolean).join(" ");
}

export async function resolveProposalClientInTransaction(
  tx: Prisma.TransactionClient, actor: DomainActor, selection: ProposalClientSelection,
  state: ProposalState, fallbackClientId?: string, environment: ProposalEnvironment = process.env,
  previousState?: Prisma.JsonValue,
) {
  const temporaryId = proposalTemporaryClientId(environment);
  const temporary = await tx.client.findUnique({ where: { id: temporaryId } });
  if (!temporary || temporary.name.trim() !== "Временный" || temporary.lastName?.trim() || temporary.middleName?.trim())
    throw new ProposalWriteError("validation", "Служебный клиент КП не прошёл проверку");
  const clientId = selection.clientId ?? fallbackClientId ?? temporaryId;
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
  let client = await tx.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ProposalWriteError("not-found", "Клиент не найден");
  const source = proposalObject(proposalObject(state.client).crmSnapshot);
  const previous = proposalObject(proposalObject(proposalObject(previousState).client).crmSnapshot);
  const fieldsOf = (value: typeof source) => Object.fromEntries(clientFields.filter(field => field in value).map(field => [field, value[field]]));
  const snapshot = previous.id === clientId || source.id === clientId || selection.clientSnapshot
    ? { ...(previous.id === clientId ? fieldsOf(previous) : {}), ...(source.id === clientId ? fieldsOf(source) : {}), ...selection.clientSnapshot }
    : undefined;
  let changed = false;
  if (clientId === temporaryId && selection.clientSnapshot)
    throw new ProposalWriteError("validation", "Служебную карточку «Временный» нельзя изменять из КП");
  if (snapshot && clientId !== temporaryId) {
    const parsed = proposalClientSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new ProposalWriteError("validation", "Некорректный структурированный снимок клиента");
    // Снимок КП авторитетен: ручные изменения CRM перезаписываются под свежей блокировкой.
    const baseline: ClientBaseline = {
      name: client.name, phone: client.phone, lastName: client.lastName, middleName: client.middleName,
      email: client.email, address: client.address, comment: client.comment,
      passportNumber: client.passportNumber, passportIssuedBy: client.passportIssuedBy,
    };
    const desired = { ...baseline, ...parsed.data };
    const input: ClientInput = {
      name: desired.name, phone: desired.phone, lastName: desired.lastName ?? undefined,
      middleName: desired.middleName ?? undefined, email: desired.email ?? undefined,
      address: desired.address ?? undefined, comment: desired.comment ?? undefined,
      passportNumber: desired.passportNumber ?? undefined, passportIssuedBy: desired.passportIssuedBy ?? undefined,
    };
    const updated = await updateClientInTransaction(tx, actor, clientId, input, baseline);
    if (!updated.ok) throw new ProposalWriteError("conflict", updated.error);
    changed = !updated.noOp;
    client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new ProposalWriteError("not-found", "Клиент не найден");
  }
  return { client, isTemporary: clientId === temporaryId, changed };
}

export function bindProposalClient(state: ProposalState, client: Client, isTemporary: boolean): ProposalState {
  const source = proposalObject(state.client);
  return {
    ...state,
    client: {
      ...source,
      ...(isTemporary ? {} : {
        name: proposalClientLabel(client),
        contact: typeof source.contact === "string" ? source.contact : client.phone,
      }),
      crmId: client.id,
      crmSnapshot: proposalClientSnapshot(client),
    },
  };
}
