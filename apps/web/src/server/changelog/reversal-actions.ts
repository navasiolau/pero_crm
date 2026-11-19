"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { dispatchEvent } from '@/server/plugins/events';
import { deliverPostCommit } from "@/server/operations/post-commit";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { JournalReversalRefusal } from "./reversal-contract";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "./reversal-core";

function refusal(error: unknown, fallback: string) {
  if (!(error instanceof JournalReversalRefusal)) return { ok: false as const, message: fallback };
  const href = error.href && /^\/(?!\/)[^\\\u0000-\u0020\u007f]*$/.test(error.href) ? error.href : undefined;
  return { ok: false as const, message: error.message, href };
}

export async function previewJournalReversal(input: unknown) {
  const id = (await auth())?.user.id;
  if (!id) return refusal(new JournalReversalRefusal("Недостаточно прав"), "");
  try {
    const preview = await prisma.$transaction(tx => previewJournalReversalInTransaction(tx, id, input));
    return { ok: true as const, ...preview };
  } catch (error) {
    return refusal(error, "Не удалось проверить возможность отката");
  }
}

export async function reverseJournalAction(input: unknown) {
  const id = (await auth())?.user.id;
  if (!id) return refusal(new JournalReversalRefusal("Недостаточно прав"), "");
  try {
    const result = await withMutationTransaction(tx => reverseJournalActionInTransaction(tx, id, input));
    const paths = new Set(["/changelog", ...(result.cachePaths ?? []), ...result.contexts.map(context =>
      `/${context.kind === "project" ? "projects" : "products"}/${encodeURIComponent(context.id)}`)]);
    await deliverPostCommit("journal-reversal", result.reversalId, [
      ...[...paths].map(path => ({ kind: "cache" as const, run: () => revalidatePath(path) })),
      ...[...new Set(result.eventIds)].map(id => ({ kind: "dispatch" as const, run: () => dispatchEvent(id) })),
    ]);
    return { ok: true as const, reversalId: result.reversalId };
  } catch (error) {
    return refusal(error, "Не удалось подтвердить откат. Повторите тот же запрос");
  }
}
