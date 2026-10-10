"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UploadError } from "@/server/files/upload-result";
import { createLogisticsTripCore, updateLogisticsTripCore } from "./core";
import { logisticsTransaction } from "./service";

async function mutate(input: unknown, operation: "create" | "update") {
  try {
    const actorId = (await auth())?.user.id;
    const result = await (operation === "create" ? createLogisticsTripCore : updateLogisticsTripCore)(actorId, input, logisticsTransaction);
    // Подтверждённый результат не теряется при сбое обновления UI; retry идемпотентен.
    await (async () => {
      revalidatePath("/logistics");
      const shares = await prisma.logisticsProjectShare.findMany({ where: { tripId: result.tripId }, select: { projectId: true } });
      for (const share of shares) revalidatePath(`/projects/${share.projectId}`);
    })().catch(() => {});
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, code: error instanceof UploadError ? error.code : "LOGISTICS_SAVE_FAILED",
      kind: error instanceof UploadError ? error.kind : "failure",
      error: error instanceof UploadError ? error.message : "Не удалось сохранить рейс. Повторите тот же запрос" };
  }
}
export async function createLogisticsTrip(input: unknown) { return mutate(input, "create"); }
export async function updateLogisticsTrip(input: unknown) { return mutate(input, "update"); }
