"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UploadError } from "@/server/files/upload-result";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { dispatchEvent } from "@/server/plugins/events";
import { createLogisticsPostingCore } from "./posting-core";

function errorResult(error: unknown) {
  return { ok: false as const, code: error instanceof UploadError ? error.code : "LOGISTICS_PAYMENT_FAILED",
    error: error instanceof Error ? error.message : "Не удалось сохранить расход рейса. Повторите тот же запрос" };
}
async function savePosting(input: unknown, mode: "post" | "correct") {
  try {
    const result = await createLogisticsPostingCore((await auth())?.user.id, input, mode, { db: prisma, transaction: withTaskTransaction });
    await (async () => {
      if (result.eventId) await dispatchEvent(result.eventId).catch(() => {});
      for (const path of ["/logistics", `/logistics/${result.tripId}`, "/finance/expenses", "/finance/accounts", "/finance/accounts/report", "/finance/payroll"])
        revalidatePath(path);
      for (const projectId of result.projectIds) { revalidatePath(`/projects/${projectId}`); revalidatePath(`/finance/projects/${projectId}`); }
    })().catch(() => {});
    return { ok: true as const, tripId: result.tripId, revision: result.revision, postingId: result.postingId, repeated: result.repeated };
  } catch (error) { return errorResult(error); }
}
export async function postLogisticsTrip(input: unknown) { return savePosting(input, "post"); }
export async function correctLogisticsTripPosting(input: unknown) { return savePosting(input, "correct"); }
