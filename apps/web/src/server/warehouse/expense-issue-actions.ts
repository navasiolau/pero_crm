"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { financeSessionSource, scopedFinanceAuth } from "@/server/telegram/finance-session";
import { prisma } from "@/lib/prisma";
import { canAssignExpenseProject } from "@/lib/expense-project-assignment";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { dispatchEvent } from "@/server/plugins/events";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { loadExpenseIssueChoices, loadExpenseIssueQuote, postExpenseIssueInTransaction } from "./expense-issue-core";

async function currentActor() {
  const session = await scopedFinanceAuth();
  if (!session?.user || !canAssignExpenseProject(session.user.roles)) throw Error("Недостаточно прав");
  const { user } = session;
  return { id: user.id, name: user.name ?? "", roles: user.roles, source: financeSessionSource(session) };
}

function failure(error: unknown) {
  return { ok: false as const, error: error instanceof z.ZodError ? "Проверьте проект, изделие и количества"
    : error instanceof Error && !error.name.startsWith("Prisma") ? error.message : "Не удалось подтвердить выдачу" };
}

export async function getExpenseIssueChoices(input: unknown) {
  try {
    const actor = await currentActor();
    const result = await prisma.$transaction(tx => loadExpenseIssueChoices(tx, actor, input), { isolationLevel: "RepeatableRead" });
    return { ok: true as const, ...result };
  } catch (error) { return failure(error); }
}

export async function previewExpenseIssue(input: unknown) {
  try {
    const actor = await currentActor();
    const result = await prisma.$transaction(tx => loadExpenseIssueQuote(tx, actor, input), { isolationLevel: "RepeatableRead" });
    return { ok: true as const, ...result };
  } catch (error) { return failure(error); }
}

export async function applyExpenseIssue(input: unknown) {
  try {
    const actor = await currentActor();
    const result = await withMutationTransaction(tx => postExpenseIssueInTransaction(tx, actor, input));
    await deliverPostCommit("stock-movement", result.issueId, [
      ...result.cachePaths.map(path => ({ kind: "cache" as const, run: () => revalidatePath(path) })),
      ...result.eventIds.map(id => ({ kind: "dispatch" as const, run: () => dispatchEvent(id) })),
    ]);
    return { ok: true as const, issueId: result.issueId };
  } catch (error) { return failure(error); }
}
