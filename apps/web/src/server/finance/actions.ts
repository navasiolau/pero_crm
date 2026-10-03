"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeChangeLog } from "@/server/plugins/changelog";
import { requireFinance } from "@/server/require-role";
import { withTaskTransaction } from "@/server/tasks/transaction";

import { getNbrbRate, isCurrency } from "./nbrb";
import { createExpenseArticleCore, toggleExpenseArticleCore, expenseArticleCreateError, type ExpenseArticleInput } from "./article-core";

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

export async function addExpenseArticle(input: ExpenseArticleInput): Promise<{ok:boolean;error?:string}> {
  const session=await requireFinance();
  try{
    const result=await withTaskTransaction(tx=>createExpenseArticleCore(session.user,input,tx));
    if(result.ok)revalidatePath('/finance/articles');
    return result.ok?{ok:true}:result;
  }catch(error){return{ok:false,error:expenseArticleCreateError(error)};}
}
export async function toggleExpenseArticle(articleId:string):Promise<{ok:boolean;error?:string}>{
  const session=await requireFinance();
  try{const result=await withTaskTransaction(tx=>toggleExpenseArticleCore(session.user,articleId,tx));if(result.ok)revalidatePath('/finance/articles');return result;}
  catch{return{ok:false,error:'Не удалось изменить активность статьи'};}
}
