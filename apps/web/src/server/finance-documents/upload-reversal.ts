import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { activePaymentWhere } from "@/server/payments/active-records";

const schema = z.object({ expectedRevision: z.int().nonnegative(), visible: z.boolean() }).strict();
type Command = z.infer<typeof schema>;

async function refusal(tx: Prisma.TransactionClient, id: string, command: Command) {
  const document = await tx.financeDocument.findUnique({ where: { id }, select: {
    state: true, visibilityRevision: true,
    payment: { where: activePaymentWhere, select: { id: true } },
    paymentReport: { where: { payment: activePaymentWhere }, select: { paymentId: true } },
  } });
  if (!document || document.visibilityRevision !== command.expectedRevision ||
      document.state !== (command.visible ? "RETAINED" : "READY")) return "Финансовый документ изменился";
  if (!command.visible && (document.payment || document.paymentReport)) return "Документ используется действующим платежом";
  return null;
}

export const financeDocumentUploadReversal = defineJournalReversal({
  kind: "finance-document.upload", version: 1, schema,
  preview: ({ tx, entityId }, command) => refusal(tx, entityId, command),
  async apply({ tx, entityId }, command) {
    await tx.$queryRaw`SELECT id FROM "FinanceDocument" WHERE id = ${entityId} FOR UPDATE`;
    const problem = await refusal(tx, entityId, command);
    if (problem) throw new JournalReversalRefusal(problem);
    const document = await tx.financeDocument.update({ where: { id: entityId },
      data: { state: command.visible ? "READY" : "RETAINED", visibilityRevision: { increment: 1 } } });
    return {
      inverse: { expectedRevision: document.visibilityRevision, visible: !command.visible },
      oldValue: { visible: !command.visible }, newValue: { visible: command.visible },
      cachePaths: ["/finance/documents"],
    };
  },
});
