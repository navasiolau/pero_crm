"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import { UploadError } from "@/server/files/upload-result";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { dispatchEvent } from "@/server/plugins/events";
import { requireLogisticsActor } from "./core";
import { createLogisticsPostingCore } from "./posting-core";
import { LOGISTICS_ARTICLE_SETTING } from "./money-contracts";

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
export async function setLogisticsExpenseArticle(articleId: string) {
  try {
    const actorId = (await auth())?.user.id;
    await withTaskTransaction(async tx => {
      const actor = await requireLogisticsActor(actorId, tx);
      if (!hasAnyRole(actor.roles, ADMIN_ROLES)) throw new UploadError("LOGISTICS_FORBIDDEN", 403, "auth", "Статью логистики выбирает администратор или директор", "forbidden");
      if (typeof articleId !== "string" || !articleId.trim() || articleId.length > 128) throw Error("Выберите статью «Логистика»");
      const article = await tx.expenseArticle.findUnique({ where: { id: articleId.trim() }, select: { id: true, active: true } });
      if (!article?.active) throw Error("Выберите действующую статью расхода");
      const old = await tx.orgSetting.findUnique({ where: { key: LOGISTICS_ARTICLE_SETTING } });
      if (old?.value === article.id) return;
      await tx.orgSetting.upsert({ where: { key: LOGISTICS_ARTICLE_SETTING }, create: { key: LOGISTICS_ARTICLE_SETTING, value: article.id }, update: { value: article.id } });
      await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, entity: "orgSetting",
        entityId: LOGISTICS_ARTICLE_SETTING, action: "update", oldValue: old?.value ?? null, newValue: article.id } });
    });
    await (async () => { revalidatePath("/logistics"); revalidatePath("/projects"); })().catch(() => {});
    return { ok: true as const };
  } catch (error) { return errorResult(error); }
}
