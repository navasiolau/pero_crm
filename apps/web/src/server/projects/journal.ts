import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import type { JournalPresentationHints } from "@/server/changelog/contract";

type NumberedEntity = { id: string; number?: string; title?: string };

export function projectJournalContext(project: NumberedEntity): JournalPresentationHints {
  const label = project.number ? `Проект ${project.number}` : "Проект";
  const href = `/projects/${encodeURIComponent(project.id)}`;
  return { entity: { type: "project", id: project.id, label, href },
    contexts: [{ kind: "project", id: project.id, label, href }] };
}

export function productJournalContext(product: NumberedEntity): JournalPresentationHints {
  const label = product.number ? `Изделие ${product.number}` : "Изделие";
  const href = `/products/${encodeURIComponent(product.id)}`;
  return { entity: { type: "product", id: product.id, label, href },
    contexts: [{ kind: "product", id: product.id, label, href }] };
}

export function proposalJournalContext(proposalId: string, project: NumberedEntity): JournalPresentationHints {
  const context = projectJournalContext(project);
  return { ...context, entity: { type: "commercialProposal", id: proposalId,
    label: project.number ? `КП ${project.number}` : "Коммерческое предложение" },
    links: [{ type:"project",id:project.id,label:project.number?`Проект ${project.number}`:'Проект',href:`/projects/${encodeURIComponent(project.id)}` }] };
}

export function automationJournalContext(actor: Pick<DomainActor, "id" | "name">, reason: string): JournalPresentationHints {
  return { actor: { type: "system", id: "system", name: "Система" },
    initiator: { id: actor.id, name: actor.name }, reason };
}

/** Снимок сохраняет Decimal и даты как точный JSON, без ORM-служебных связей. */
export function businessSnapshot(value: object, fields: readonly string[]): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  return JSON.parse(JSON.stringify(Object.fromEntries(fields.filter(field => source[field] !== undefined).map(field => [field, source[field]])))) as Record<string, unknown>;
}

export const PROJECT_JOURNAL_FIELDS = ["number", "title", "clientId", "managerId", "address", "currency", "stage", "initialPrice", "servicesTotal", "delivery", "unloading", "installation", "proposalRoundingAdjustment", "refusalReason", "refusalComment", "deletedAt"] as const;
export const PRODUCT_JOURNAL_FIELDS = ["number", "title", "kind", "quantity", "status", "expectedPrice", "initialPrice", "engineerId", "description", "technicalSpecifications", "sketchFileId", "deletedAt"] as const;

/** Имена ссылок фиксируются внутри той же транзакции, а не при просмотре истории. */
export async function journalPersonLinks(tx: Pick<Prisma.TransactionClient, "user">, ids: readonly (string | null | undefined)[], actor: Pick<DomainActor, "id" | "name">) {
  return Promise.all([...new Set(ids.filter((id): id is string => !!id))].map(async id => {
    const user = id === actor.id ? actor : await tx.user.findFirst({ where: { id }, select: { id: true, name: true } });
    return { type: "user", id, label: user?.name || "Пользователь без сохранённого имени" };
  }));
}
