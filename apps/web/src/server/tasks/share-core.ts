import type { DomainActor } from "@/server/projects/core";
import { z } from "zod";
import { FULL_SHARE_UNITS, splitAllocation } from "@/lib/work-shares";
import { resolveVisibilityActor, taskExecutionWhere } from "@/server/access/visibility";
import type { TaskTransaction } from "./transaction";

export type SplitTaskInput = { taskId: string; recipientId: string; percent: string; expectedRevision: number; requestId: string };
export type SplitTaskResult = { ok: false; error: string } | {
  ok: true; childTaskId: string; groupId: string; repeated: boolean;
  projectId: string; productId: string | null; projectNumber: string; title: string; recipientId: string; eventId: string | null;
};

const schema = z.object({
  taskId: z.string().min(1), recipientId: z.string().min(1), percent: z.string().min(1).max(8),
  expectedRevision: z.number().int().nonnegative(), requestId: z.uuid(),
});

export async function splitTaskCore(actor: DomainActor, input: SplitTaskInput, transaction: TaskTransaction): Promise<SplitTaskResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте сотрудника, процент и ревизию задачи" };
  let percent: string;
  try { percent = splitAllocation(FULL_SHARE_UNITS, "0", parsed.data.percent).percent; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Некорректный процент" }; }
  const data = parsed.data;

  return transaction(async (tx): Promise<SplitTaskResult> => {
    const visibilityActor = await resolveVisibilityActor(tx, actor);
    const task = await tx.task.findFirst({
      where: { AND: [{ id: data.taskId }, taskExecutionWhere(visibilityActor)] },
      include: {
        project: { select: { number: true, currency: true } },
        product: { select: { engineerId: true, status: true, projectId: true } },
        work: { select: {
          id: true, projectId: true, productId: true, priceSnapshot: true, paymentKind: true, stagePayPoolId: true,
          stagePayPool: { select: { id: true, kind: true, state: true, productId: true, product: { select: { projectId: true } } } },
        } },
        allocationGroup: true,
        _count: { select: { payrollEntries: true } },
      },
    });
    if (!task) return { ok: false, error: "Задача не найдена или недоступна" };
    const context = { projectId: task.projectId, productId: task.productId, projectNumber: task.project.number, title: task.title, recipientId: data.recipientId };
    const receiptId = `task-split:${data.requestId}`;
    const receipt = await tx.changeLog.findUnique({ where: { id: receiptId } });
    if (receipt) {
      const saved = receipt.newValue;
      if (receipt.actorId !== actor.id || receipt.entityId !== task.id || receipt.action !== "split" || !saved || typeof saved !== "object" || Array.isArray(saved) ||
        saved.recipientId !== data.recipientId || saved.percent !== percent || saved.expectedRevision !== data.expectedRevision || typeof saved.childTaskId !== "string" || typeof saved.groupId !== "string") {
        return { ok: false, error: "Этот запрос уже использован для другого разделения" };
      }
      return { ok: true, childTaskId: saved.childTaskId, groupId: saved.groupId, repeated: true, eventId: null, ...context };
    }
    return { ok: false, error: "Деление задач и передача долей больше недоступны" };
  });
}
