"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeChangeLog } from "@/server/plugins/changelog";
import { requireFinance, requireRole } from "@/server/require-role";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { DEFAULT_CASH_ACCOUNT_MANAGE_ROLES } from "@/lib/cash-account-default";
import { saveDefaultCashAccount, toggleCashAccountCore } from "./default-cash-core";
import type { DefaultCashAccountPatch, DefaultCashAccountResult } from "./default-cash-contracts";
import type { ExpenseArticleCreateResult } from "./contracts";

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
  try {
    const result = await withTaskTransaction(tx => toggleCashAccountCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, accountId, tx));
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch { return { ok: false, error: "Не удалось изменить активность кассы" }; }
}

export async function setDefaultCashAccount(input: DefaultCashAccountPatch): Promise<DefaultCashAccountResult> {
  const session = await requireRole(DEFAULT_CASH_ACCOUNT_MANAGE_ROLES);
  try {
    const result = await withTaskTransaction(tx => saveDefaultCashAccount({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input, tx));
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch { return { ok: false, kind: "failure", error: "Не удалось сохранить кассу по умолчанию" }; }
}

// ─── Статьи расходов ────────────────────────────────────────────────────────

export async function addExpenseArticle(input: ExpenseArticleInput): Promise<ExpenseArticleCreateResult> {
  const session=await requireFinance();
  try{
    const result=await withTaskTransaction(tx=>createExpenseArticleCore(session.user,input,tx));
    if(result.ok)revalidatePath('/finance/articles');
    return result.ok?{ok:true,article:{id:result.article.id,name:result.article.name}}:result;
  }catch(error){return{ok:false,error:expenseArticleCreateError(error)};}
}
export async function toggleExpenseArticle(articleId:string):Promise<{ok:boolean;error?:string}>{
  const session=await requireFinance();
  try{const result=await withTaskTransaction(tx=>toggleExpenseArticleCore(session.user,articleId,tx));if(result.ok)revalidatePath('/finance/articles');return result;}
  catch{return{ok:false,error:'Не удалось изменить активность статьи'};}
}
