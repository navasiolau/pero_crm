"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";
import { requireFinance } from "@/server/require-role";
import { withTaskTransaction } from "@/server/tasks/transaction";

import { getNbrbRate, isCurrency } from "./nbrb";

// ─── Финансы (§11): кассы, статьи расходов, курсы НБ РБ ─────────────────────

// Подтянуть курс НБ РБ для диалога платежа (автозаполнение поля курса;
// пользователь может поправить вручную — §11).
export async function fetchNbrbRate(
  currency: string,
  date?: string,
): Promise<{ ok: boolean; rate?: number; date?: string; error?: string }> {
  await requireFinance();
  if (!isCurrency(currency)) return { ok: false, error: "Неизвестная валюта" };
  try {
    const parsed = date ? new Date(`${date}T12:00:00`) : undefined;
    const rate = await getNbrbRate(currency, parsed);
    return { ok: true, rate: rate.rate, date: rate.date };
  } catch {
    return {
      ok: false,
      error: "Не удалось получить курс НБ РБ — введите вручную",
    };
  }
}

// ─── Кассы ──────────────────────────────────────────────────────────────────

const cashAccountSchema = z.object({
  name: z.string().trim().min(1, "Укажите название кассы"),
  currency: z.string(),
  comment: z.string().optional(),
});

export async function addCashAccount(
  input: z.input<typeof cashAccountSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
  const parsed = cashAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  if (!isCurrency(parsed.data.currency)) {
    return { ok: false, error: "Неизвестная валюта" };
  }
  const account = await withTaskTransaction((tx) => tx.cashAccount.create({
    data: {
      name: parsed.data.name,
      currency: parsed.data.currency,
      comment: parsed.data.comment?.trim() || null,
    },
  }));
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "cashAccount",
    entityId: account.id,
    action: "create",
    newValue: { name: account.name, currency: account.currency },
  });
  revalidatePath("/finance/accounts");
  return { ok: true };
}

// Деактивация/активация: кассу с историей операций не удаляем,
// а исключаем из выбора в новых операциях.
export async function toggleCashAccount(
  accountId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
  const account = await withTaskTransaction(async (tx) => {
    const current = await tx.cashAccount.findUnique({ where: { id: accountId } });
    if (!current) return null;
    await tx.cashAccount.update({ where: { id: accountId }, data: { active: !current.active } });
    return current;
  });
  if (!account) return { ok: false, error: "Касса не найдена" };
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "cashAccount",
    entityId: accountId,
    action: "update",
    field: "active",
    oldValue: account.active,
    newValue: !account.active,
  });
  revalidatePath("/finance/accounts");
  return { ok: true };
}

// ─── Статьи расходов ────────────────────────────────────────────────────────

const articleSchema = z.object({
  name: z.string().trim().min(1, "Укажите название статьи"),
  comment: z.string().optional(),
});

export async function addExpenseArticle(
  input: z.input<typeof articleSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
  const parsed = articleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const article = await prisma.expenseArticle.create({
    data: {
      name: parsed.data.name,
      comment: parsed.data.comment?.trim() || null,
    },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "expenseArticle",
    entityId: article.id,
    action: "create",
    newValue: { name: article.name },
  });
  revalidatePath("/finance/articles");
  return { ok: true };
}

export async function toggleExpenseArticle(
  articleId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
  const article = await prisma.expenseArticle.findUnique({
    where: { id: articleId },
  });
  if (!article) return { ok: false, error: "Статья не найдена" };
  await prisma.expenseArticle.update({
    where: { id: articleId },
    data: { active: !article.active },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "expenseArticle",
    entityId: articleId,
    action: "update",
    field: "active",
    oldValue: article.active,
    newValue: !article.active,
  });
  revalidatePath("/finance/articles");
  return { ok: true };
}
