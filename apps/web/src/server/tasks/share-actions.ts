"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { splitTaskCore, type SplitTaskInput } from "./share-core";
import { withTaskTransaction } from "./transaction";

export async function getTaskSplitOptions(taskId: string): Promise<{ ok: false; error: string } | {
  ok: true; options: { id: string; name: string; hint: string; disabledReason: string | null }[];
  share: { units: number; amount: string | null; currency: string | null; quantity: string | null; revision: number; source: "LEGACY" | "ENGINEERING" | "INSTALLATION"; stageUnits: number | null; previewAmount: string | null; previewCurrency: string | null; previewReason: string | null; settledSource: boolean; engineeringPreview: { workAmount: string; currency: string; tasks: { id: string; stageShareUnits: number; createdAt: string }[] } | null };
  assigneeName: string;
}> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Не авторизован" };
  void taskId;
  return { ok: false, error: "Деление задач и передача долей больше недоступны" };
}

export async function splitTask(input: SplitTaskInput): Promise<{ ok: boolean; error?: string; childTaskId?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Не авторизован" };
  const result = await splitTaskCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input, withTaskTransaction);
  if (!result.ok) return result;
  revalidatePath("/my"); revalidatePath("/tasks"); revalidatePath(`/projects/${result.projectId}`);
  await revalidateProductPaths(result.productId);
  return { ok: true, childTaskId: result.childTaskId };
}
