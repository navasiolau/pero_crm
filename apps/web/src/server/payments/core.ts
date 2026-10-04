import {liveProjectWhere} from "@/server/access/live-entities";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";

import { getNbrbRate, isCurrency } from "@/server/finance/nbrb";
import { requireActorRoles, type DomainActor } from "@/server/projects/core";
import { FINANCE_ROLES } from "@/lib/roles";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { readCashBalance, readOrgBalance } from "@/server/payroll/cash-core";
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";

// Ядро создания платежа (§11): приход от клиента или расход на проект.
// Используется и вебом (finance-tab), и telegram-ботом — актёр передаётся
// явно (source попадает в журнал изменений). Проверки ролей (FINANCE_ROLES),
// кассы/статьи/курса НБ РБ — здесь, единообразно для обоих каналов.

export const paymentSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  direction: z.enum(["INCOME", "EXPENSE"]),
  amount: z.number().positive("Сумма должна быть больше нуля"),
  currency: z.string(),
  cashAccountId: z.string().min(1, "Выберите кассу"),
  expenseArticleId: z.string().optional(),
  // Курс (BYN за единицу валюты) и его дата — если пользователь поправил
  // вручную; иначе сервер подтянет с НБ РБ на дату операции
  rate: z.number().positive().optional(),
  rateDate: z.string().optional(), // YYYY-MM-DD
  paidAt: z.string().optional(), // YYYY-MM-DD; пусто — сейчас
  comment: z.string().optional(),
}).refine(data => data.direction !== "EXPENSE" || !!data.projectId, { message: "Для расхода выберите действующий проект", path: ["projectId"] }).refine(data => data.direction !== "INCOME" || !data.expenseArticleId, { message: "У прихода не может быть статьи расхода", path: ["expenseArticleId"] });

export async function createPaymentCore(
  actor: DomainActor,
  input: z.input<typeof paymentSchema>,
): Promise<{ ok: boolean; error?: string }> {
  requireActorRoles(actor, FINANCE_ROLES);
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  if (!isCurrency(data.currency)) return { ok: false, error: "Неизвестная валюта" };

  const project = data.projectId ? await prisma.project.findUnique({
    where: {...liveProjectWhere, id: data.projectId },
    select: { id: true, number: true, currency: true },
  }) : null;
  if (data.projectId && !project) return { ok: false, error: "Проект не найден" };
  try { if (project) assertProjectMoneyCurrency(project.currency); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Сначала подготовьте проект в BYN" }; }

  // Касса: операция проводится только в валюте кассы (деньги физически
  // лежат в кассе в её валюте; эквиваленты — в полях курса операции)
  const account = await prisma.cashAccount.findUnique({
    where: { id: data.cashAccountId },
  });
  if (!account || !account.active) return { ok: false, error: "Касса не найдена" };
  if (account.currency !== data.currency) {
    return {
      ok: false,
      error: `Касса «${account.name}» в ${account.currency} — выберите кассу в валюте операции`,
    };
  }

  let articleId: string | null = null;
  if (data.direction === "EXPENSE" && !data.expenseArticleId) {
    return { ok: false, error: "Выберите статью расхода" };
  }
  if (data.expenseArticleId) {
    const article = await prisma.expenseArticle.findUnique({
      where: { id: data.expenseArticleId },
    });
    if (!article || !article.active) {
      return { ok: false, error: "Статья расхода не найдена" };
    }
    articleId = article.id;
  }

  const paidAt = data.paidAt ? new Date(`${data.paidAt}T12:00:00`) : new Date();
  const amountDecimal = new Prisma.Decimal(data.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const amount = amountDecimal.toNumber();

  // Курс: ручной ввод имеет приоритет (§11), иначе — НБ РБ на дату операции.
  // Если НБ РБ недоступен — просим ввести курс вручную (§19).
  let rate: number;
  let rateDate: Date | null = null;
  if (data.currency === "BYN") {
    rate = 1;
  } else if (data.rate) {
    rate = data.rate;
    rateDate = data.rateDate ? new Date(`${data.rateDate}T12:00:00`) : paidAt;
  } else {
    try {
      const fetched = await getNbrbRate(data.currency, paidAt);
      rate = fetched.rate;
      rateDate = new Date(`${fetched.date}T12:00:00`);
    } catch {
      return {
        ok: false,
        error: "Не удалось получить курс НБ РБ — введите курс вручную",
      };
    }
  }

  // Проект уже проверен как BYN. Считаем фиксированный эквивалент Decimal:
  // полкопейки округляется вверх без ошибки двоичного умножения.
  const rateDecimal = new Prisma.Decimal(rate);
  const bynDecimal = amountDecimal.times(rateDecimal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const equiv = { bynAmount: bynDecimal.toNumber(), projectAmount: project ? bynDecimal.toNumber() : null };

  let result;
  try {
    result = await withTaskTransaction(tx => createPaymentInTransaction(actor, data, {project,account,articleId,paidAt,rate,rateDate,amount,bynAmount:equiv.bynAmount},tx));
  } catch(error) { return {ok:false,error:error instanceof Error?error.message:"Не удалось внести платёж"}; }
  const isIncome = data.direction === "INCOME";
  const kind = isIncome ? "Приход" : "Расход";
  await dispatchEvent(result.eventId).catch(() => {});
  await notifyOrg({
    type: isIncome ? "payment.added" : "expense.added",
    title: `${kind} ${formatAmount(amount, data.currency)} · ${project?.number ?? "Организация"}`,
    body: data.comment?.trim() || undefined,
    link: project ? `/finance/projects/${project.id}` : "/finance/income",
    exceptUserId: actor.id,
  }).catch(() => {});

  if (project) revalidatePath(`/projects/${project.id}`);
  revalidatePath("/finance/income");
  revalidatePath("/finance/payroll");
  revalidatePath("/finance/accounts");
  return { ok: true };
}

export type PreparedPayment = {project:{id:string;number:string;currency:string}|null;account:{id:string;name:string};articleId:string|null;paidAt:Date;rate:number;rateDate:Date|null;amount:number;bynAmount:number};
export async function createPaymentInTransaction(actor:DomainActor,input:z.input<typeof paymentSchema>,prepared:PreparedPayment,tx:Prisma.TransactionClient){
 requireActorRoles(actor,FINANCE_ROLES);const data=paymentSchema.parse(input);
 if(!isCurrency(data.currency)||data.cashAccountId!==prepared.account.id)throw Error("Реквизиты кассы изменились");
 const amount=new Prisma.Decimal(data.amount).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
 if(!Number.isFinite(prepared.rate)||prepared.rate<=0||(data.currency==='BYN'&&prepared.rate!==1)||!amount.eq(prepared.amount)||!amount.times(prepared.rate).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP).eq(prepared.bynAmount))throw Error("Денежный снимок изменился");
 if((data.projectId??null)!==(prepared.project?.id??null))throw Error("Реквизиты проекта изменились");
 if((data.expenseArticleId||null)!==prepared.articleId)throw Error("Реквизиты статьи изменились");
 const [project,account,article]=await Promise.all([prepared.project?tx.project.findUnique({where:{...liveProjectWhere,id:prepared.project.id},select:{currency:true}}):Promise.resolve(null),tx.cashAccount.findUnique({where:{id:prepared.account.id},select:{active:true,currency:true}}),prepared.articleId?tx.expenseArticle.findUnique({where:{id:prepared.articleId},select:{active:true}}):Promise.resolve(null)]);
 if((prepared.project&&project?.currency!==prepared.project.currency)||!account?.active||account.currency!==data.currency||(prepared.articleId&&!article?.active))throw Error("Реквизиты платежа изменились — обновите форму");
 if(project)assertProjectMoneyCurrency(project.currency);
 if(data.direction==='EXPENSE'){if(!prepared.articleId)throw Error("Выберите статью расхода");const [cash,org]=await Promise.all([readCashBalance(tx,prepared.account.id),readOrgBalance(tx,'1.000000',new Prisma.Decimal(prepared.bynAmount).negated().toFixed(2))]);if(cash.lt(prepared.amount))throw Error("Недостаточно средств в выбранной кассе");if(org.lt(0))throw Error("Недостаточно средств на балансе организации");}
 const payment=await tx.payment.create({data:{projectId:prepared.project?.id??null,direction:data.direction,amount:prepared.amount,currency:data.currency,rate:prepared.rate,rateDate:prepared.rateDate,bynAmount:prepared.bynAmount,projectAmount:prepared.project?prepared.bynAmount:null,cashAccountId:prepared.account.id,expenseArticleId:prepared.articleId,paidAt:prepared.paidAt,comment:data.comment?.trim()||null,createdById:actor.id}});
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name||undefined,entity:'payment',entityId:payment.id,action:'create',source:actor.source,newValue:{project:prepared.project?.number??null,direction:data.direction,amount:prepared.amount,currency:data.currency,rate:prepared.rate,bynAmount:prepared.bynAmount,projectAmount:prepared.project?prepared.bynAmount:null,cashAccount:prepared.account.name}}});
 const event=await tx.domainEvent.create({data:{type:data.direction==='INCOME'?'payment.created':'expense.created',actor:actor.id,payload:{paymentId:payment.id,projectId:prepared.project?.id??null,direction:data.direction,amount:prepared.amount,currency:data.currency,bynAmount:prepared.bynAmount}}});
 return{payment,eventId:event.id};
}
