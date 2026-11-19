import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import { JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { officeDirectoryReversal } from "@/server/changelog/office-directory-reversal";

export const proposalClientEffectSchema = z.object({
  clientId: z.string().min(1),
  command: z.object({ kind: z.literal("office.directory"), version: z.literal(1),
    data: z.record(z.string(), z.json()) }).strict(),
 }).strict().refine(({ clientId, command }) => {
  const first = Array.isArray(command.data.steps) && command.data.steps.length === 1 ? command.data.steps[0] : null;
  return command.data.targetId === clientId && first !== null && typeof first === "object" &&
    !Array.isArray(first) && first.kind === "client" && first.id === clientId;
});
export type ProposalClientEffect = z.infer<typeof proposalClientEffectSchema>;
type Context = { tx: Prisma.TransactionClient; actor: DomainActor; entryId: string; reversalId?: string };

export async function previewProposalClientEffect(context: Context, data: ProposalClientEffect | undefined) {
  if (!data) return null;
  const handler = officeDirectoryReversal.read(data.command.data);
  return handler ? handler.preview({ ...context, entityId: data.clientId }) : "Не удалось прочитать сохранённые сведения о клиенте";
}

export async function applyProposalClientEffect(context: Context, data: ProposalClientEffect | undefined) {
  if (!data) return undefined;
  const handler = officeDirectoryReversal.read(data.command.data);
  if (!handler) throw new JournalReversalRefusal("Не удалось прочитать сохранённые сведения о клиенте");
  const applied = await handler.apply({ ...context, entityId: data.clientId });
  return { inverse: proposalClientEffectSchema.parse({ clientId: data.clientId, command: applied.reversal }),
    cachePaths: applied.cachePaths ?? [], eventIds: applied.eventIds ?? [] };
}
