import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";

import { equivalents, getNbrbRate, isCurrency } from "@/server/finance/nbrb";
import { requireActorRoles, type DomainActor } from "@/server/projects/core";
import { FINANCE_ROLES } from "@/lib/roles";

// Ядро создания платежа (§11): приход от клиента или расход на проект.
// Используется и вебом (finance-tab), и telegram-ботом — актёр передаётся
// явно (source попадает в журнал изменений). Проверки ролей (FINANCE_ROLES),
// кассы/статьи/курса НБ РБ — здесь, единообразно для обоих каналов.

export const paymentSchema = z.object({
  projectId: z.string().min(1),
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
});

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

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

  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, number: true, currency: true },
  });
  if (!project) return { ok: false, error: "Проект не найден" };
  if (!isCurrency(project.currency)) {
    return { ok: false, error: `Неизвестная валюта проекта: ${project.currency}` };
  }

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
  if (data.direction === "EXPENSE") {
    if (!data.expenseArticleId) {
      return { ok: false, error: "Выберите статью расхода" };
    }
    const article = await prisma.expenseArticle.findUnique({
      where: { id: data.expenseArticleId },
    });
    if (!article || !article.active) {
      return { ok: false, error: "Статья расхода не найдена" };
    }
    articleId = article.id;
  }

  const paidAt = data.paidAt ? new Date(`${data.paidAt}T12:00:00`) : new Date();
  const amount = round2(data.amount);

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

  // Эквивалент в валюте проекта: при совпадении валют — сумма как есть,
  // иначе кросс-курс через BYN (курс валюты проекта — тоже с НБ РБ).
  let projectRate = 1;
  if (project.currency !== data.currency && project.currency !== "BYN") {
    try {
      projectRate = (await getNbrbRate(project.currency, paidAt)).rate;
    } catch {
      return {
        ok: false,
        error: `Не удалось получить курс ${project.currency} (валюта проекта) с НБ РБ`,
      };
    }
  }
  const equiv =
    project.currency === data.currency
      ? { bynAmount: round2(amount * rate), projectAmount: amount }
      : equivalents(amount, rate, projectRate);

  const payment = await prisma.payment.create({
    data: {
      projectId: project.id,
      direction: data.direction,
      amount,
      currency: data.currency,
      rate,
      rateDate,
      bynAmount: equiv.bynAmount,
      projectAmount: equiv.projectAmount,
      cashAccountId: account.id,
      expenseArticleId: articleId,
      paidAt,
      comment: data.comment?.trim() || null,
      createdById: actor.id,
    },
  });

  const isIncome = data.direction === "INCOME";
  const kind = isIncome ? "Приход" : "Расход";
  await writeChangeLog({
    actorType: "user",
    actorId: actor.id,
    actorName: actor.name || undefined,
    entity: "payment",
    entityId: payment.id,
    action: "create",
    newValue: {
      project: project.number,
      direction: data.direction,
      amount,
      currency: data.currency,
      rate,
      bynAmount: equiv.bynAmount,
      projectAmount: equiv.projectAmount,
      cashAccount: account.name,
    },
    source: actor.source,
  });
  await emitDomainEvent(
    isIncome ? "payment.created" : "expense.created",
    {
      paymentId: payment.id,
      projectId: project.id,
      direction: data.direction,
      amount,
      currency: data.currency,
      bynAmount: equiv.bynAmount,
    },
    actor.id,
  );
  await notifyOrg({
    type: isIncome ? "payment.added" : "expense.added",
    title: `${kind} ${formatAmount(amount, data.currency)} · ${project.number}`,
    body: data.comment?.trim() || undefined,
    link: `/projects/${project.id}`,
    exceptUserId: actor.id,
  });

  revalidatePath(`/projects/${project.id}`);
  revalidatePath("/finance/payroll");
  revalidatePath("/finance/accounts");
  return { ok: true };
}
