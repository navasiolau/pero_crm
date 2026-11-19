import { z } from "zod";
import { defineFieldReversal } from "@/server/changelog/field-reversal";
import { JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { liveProjectWhere } from "@/server/access/live-entities";
import { lockProjectRow } from "./lock";
import { updateProjectCardValuesInTransaction } from "./project-field-core";
import { patchProjectContactInTransaction } from "./contact-core";
import { PROJECT_CARD_FIELDS, projectFieldKind, projectFieldState, type ProjectCardField } from "./field-reversal-data";
import { projectMoneySchema } from "./patch-contract";

const text = z.string().nullable();
const money = projectMoneySchema;
const binding = z.object({ clientId: z.string().min(1), contactPerson: text });
const services = z.object({ servicesTotal: money, delivery: money, unloading: money, installation: money })
  .refine(snapshot => snapshot.servicesTotal === null || [snapshot.delivery, snapshot.unloading, snapshot.installation].every(value => value === null));
const schemas: Record<ProjectCardField, z.ZodType<string | null | z.infer<typeof binding> | z.infer<typeof services>>> = {
  title: z.string().min(1), managerId: text, address: text, contactBinding: binding, services,
};

export const projectFieldReversals = PROJECT_CARD_FIELDS.map(field => defineFieldReversal({
  kind: projectFieldKind(field), entity: "project", field, value: schemas[field], lock: lockProjectRow,
  async read(tx, id) {
    const project = await tx.project.findUnique({ where: { id, ...liveProjectWhere } });
    return project ? projectFieldState(field, project) : null;
  },
  async update(ctx, previous, value) {
    const { tx, actor, entityId } = ctx;
    const where = { id: entityId, ...liveProjectWhere };
    const cachePaths = ["/projects", `/projects/${encodeURIComponent(entityId)}`, ...(field === "services" ? ["/finance"] : [])];
    const project = await tx.project.findUniqueOrThrow({ where });
    if (field === "address" || field === "contactBinding") {
      const before = binding.safeParse(previous);
      const after = binding.safeParse(value);
      const patch = field === "address" && (typeof value === "string" || value === null) && (typeof previous === "string" || previous === null)
        ? { field: "address" as const, value, expectedValue: previous }
        : before.success && after.success && before.data.clientId !== after.data.clientId
          ? { field: "clientId" as const, value: after.data.clientId, expectedValue: before.data.clientId }
          : before.success && after.success
            ? { field: "contactPerson" as const, value: after.data.contactPerson, expectedValue: before.data.contactPerson, expectedClientId: before.data.clientId }
            : null;
      if (!patch) throw new JournalReversalRefusal("Не удалось проверить исходный контакт проекта");
      if (patch.field === "clientId") {
        const proposal = await tx.commercialProposal.findFirst({ where: { projectId: entityId, deletedAt: null }, select: { clientId: true } });
        if (proposal && proposal.clientId !== patch.expectedValue)
          throw new JournalReversalRefusal("Клиент связанного КП изменился", cachePaths[1]);
      }
      const result = await patchProjectContactInTransaction(actor, { projectId: entityId, ...patch }, tx, {
        operationRootId: ctx.reversalId, ...(after.success ? { restoreContactPerson: after.data.contactPerson } : {}),
      });
      if (!result.ok) throw new JournalReversalRefusal(result.error, cachePaths[1]);
      const restored = await tx.project.findUniqueOrThrow({ where });
      return { ...projectFieldState(field, restored), eventIds: result.eventIds, cachePaths };
    }
    const values = field === "services" ? services.parse(value) : { [field]: text.parse(value) };
    try {
      const restored = await updateProjectCardValuesInTransaction(tx, actor, project, values);
      return { ...projectFieldState(field, restored.after), eventIds: restored.eventId ? [restored.eventId] : [], cachePaths };
    } catch (error) {
      if (error instanceof Error && error.message === "Выберите активного менеджера")
        throw new JournalReversalRefusal("Исходный менеджер больше недоступен", cachePaths[1]);
      throw error;
    }
  },
}));
