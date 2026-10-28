"use server";

import { revalidatePath } from "next/cache";
import { LOGISTICS_DELETE_ROLES } from "@/lib/logistics-access";
import { requireRole } from "@/server/require-role";
import { UploadError } from "@/server/files/upload-result";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { dispatchEvent } from "@/server/plugins/events";
import { deleteLogisticsTripCore } from "./delete-core";

export async function deleteLogisticsTrip(input: unknown) {
  try {
    const session = await requireRole(LOGISTICS_DELETE_ROLES);
    const result = await deleteLogisticsTripCore(session.user.id, input, withTaskTransaction);
    await (async () => {
      if (result.eventId) await dispatchEvent(result.eventId).catch(() => {});
      revalidatePath("/logistics"); revalidatePath(`/logistics/${result.tripId}`); revalidatePath("/finance", "layout");
      for (const projectId of result.projectIds) { revalidatePath(`/projects/${projectId}`); revalidatePath(`/finance/projects/${projectId}`); }
    })().catch(() => {});
    return { ok: true as const, tripId: result.tripId, revision: result.revision, deletedAt: result.deletedAt, repeated: result.repeated };
  } catch (error) {
    return { ok: false as const, code: error instanceof UploadError ? error.code : "LOGISTICS_DELETE_FAILED",
      error: error instanceof Error ? error.message : "Не удалось удалить рейс. Повторите тот же запрос" };
  }
}
