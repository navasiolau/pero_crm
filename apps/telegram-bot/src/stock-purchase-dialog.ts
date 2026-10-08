import { randomUUID } from "node:crypto";
import { crm, CrmError, type DirectoryItem, type StockReceiptQuote } from "./crm";
import { dialogChoices, dialogChoice, positiveDecimalDraft, CANCEL_ROW as cancel, type DialogContext } from "./dialog-choices";
import { formatMoney } from "./views";
import type { TgMessage } from "./tg";
import { documentAttempt, uploadFinanceDocument, documentUploadError, type DocumentAttempt, type ReportDocument } from "./finance-document-upload";

type StockInput = { clientMutationId: string; materialId: string; quantity: string; unitPrice: string; currency: string; cashAccountId: string; expenseArticleId: string;
  rate?: number; rateDate?: string; comment?: string; reportDocumentId?: string };
export type StockPurchaseDialog = {
  kind: "stockPurchase"; step: "material" | "quantity" | "cash" | "price" | "article" | "rate" | "comment" | "document" | "quote" | "confirm";
  input: StockInput; materialLabel?: string; unit?: string; cashLabel?: string; articleLabel?: string;
  choices?: DirectoryItem[]; choiceToken?: string; quote?: StockReceiptQuote; busy?: boolean;
  documentAttempt?: DocumentAttempt; reportDocument?: ReportDocument; retryRate?: boolean;
};
type FlowContext = DialogContext<StockPurchaseDialog>;
export async function startStockPurchase(ctx: FlowContext, chatId: number) {
  const dialog: StockPurchaseDialog = { kind: "stockPurchase", step: "material", input: {
    clientMutationId: randomUUID(), materialId: "", quantity: "", unitPrice: "", currency: "", cashAccountId: "", expenseArticleId: "",
  } };
  ctx.setDialog(chatId, dialog);
  await ctx.reply(chatId, "Приход с оплатой из кассы. Введите название или артикул материала:", [cancel]);
}
async function choose(ctx: FlowContext, chatId: number, actorId: string, dialog: StockPurchaseDialog, type: "materials" | "cash" | "articles", query?: string) {
  const response = await crm.directory(actorId, type, query);
  if (ctx.getDialog(chatId) !== dialog) return;
  if (!response.ok) { await ctx.reply(chatId, response.error ?? "Не удалось загрузить список"); return; }
  const items = response.items ?? [];
  dialog.choices = items; const choice=dialogChoices("sp",dialog.input.clientMutationId,items); dialog.choiceToken=choice.token;
  if (!items.length) { await ctx.reply(chatId, type === "materials" ? "Материал не найден. Уточните название:" : "Нет доступных вариантов. Проверьте справочник в CRM.", [cancel]); return; }
  const label = type === "materials" ? "Материал:" : type === "cash" ? "Касса оплаты:" : "Статья расхода:";
  await ctx.reply(chatId,label,[...choice.buttons,cancel]);
}
async function confirm(ctx: FlowContext, chatId: number, actorId: string, dialog: StockPurchaseDialog) {
  dialog.step = "quote";
  const response = await crm.quoteStockReceipt(actorId, dialog.input).catch(error => ({ ok: false, quote: undefined,
    error: error instanceof CrmError ? error.message : "Расчёт недоступен" }));
  if (ctx.getDialog(chatId) !== dialog) return;
  if (!response.ok || !response.quote) {
    await ctx.reply(chatId, `❌ ${response.error ?? "Не удалось рассчитать закупку"}. Данные сохранены.`, [
      [{ text: "Повторить расчёт", callback_data: `sp:${dialog.input.clientMutationId}:quote` }],
      ...(dialog.input.currency !== "BYN" ? [[{ text: "Ввести курс", callback_data: `sp:${dialog.input.clientMutationId}:rate` }]] : []), cancel,
    ]); return;
  }
  dialog.quote = response.quote; dialog.step = "confirm";
  dialog.input.rate = response.quote.rate; dialog.input.rateDate = response.quote.rateDate ?? undefined;
  await ctx.reply(chatId, [
    "Подтвердите приход на склад:",
    `${response.quote.materialName}: ${response.quote.quantity} ${response.quote.unit} × ${response.quote.unitPrice} ${response.quote.currency}`,
    `Из кассы «${dialog.cashLabel}»: ${formatMoney(response.quote.amount, response.quote.currency)}`,
    `Стоимость запаса: ${formatMoney(response.quote.bynAmount,"BYN")}`,
    `Статья: ${dialog.articleLabel}`, `Комментарий: ${dialog.input.comment ?? "—"}`,
    `Отчетный документ: ${dialog.reportDocument?.fileName ?? "Без документа"}`,
  ].join("\n"), [[{ text: "✅ Оплатить и принять", callback_data: `sp:${dialog.input.clientMutationId}:ok` }], cancel]);
}
function skipDocument(dialog: StockPurchaseDialog) {
  return [{ text: "Без документа", callback_data: `sp:${dialog.input.clientMutationId}:nodoc` }];
}
function attemptToken(attempt: DocumentAttempt) { return attempt.clientMutationId.replaceAll("-", "").slice(0, 12); }
async function uploadDocument(ctx: FlowContext, chatId: number, actorId: string, dialog: StockPurchaseDialog) {
  const attempt = dialog.documentAttempt;
  if (!attempt) return;
  try {
    const document = await uploadFinanceDocument(actorId, attempt);
    if (ctx.getDialog(chatId) !== dialog) return;
    dialog.reportDocument = document; dialog.input.reportDocumentId = document.id;
    await confirm(ctx, chatId, actorId, dialog);
  } catch (error) {
    if (ctx.getDialog(chatId) !== dialog) return;
    await ctx.reply(chatId, `❌ ${documentUploadError(error)}. Данные прихода сохранены.`, [
      [{ text: "Повторить загрузку", callback_data: `sp:${dialog.input.clientMutationId}:docretry:${attemptToken(attempt)}` }],
      skipDocument(dialog), cancel,
    ]);
  }
}
export async function stockPurchaseDocument(ctx: FlowContext, chatId: number, actorId: string, dialog: StockPurchaseDialog, message: TgMessage) {
  if (dialog.busy) return;
  if (!["comment", "document"].includes(dialog.step)) {
    await ctx.reply(chatId, "Сначала завершите ввод данных прихода."); return;
  }
  if (dialog.step === "comment") dialog.input.comment = message.caption?.trim() || undefined;
  dialog.step = "document";
  dialog.documentAttempt = documentAttempt(message, dialog.documentAttempt);
  dialog.busy = true;
  try { await uploadDocument(ctx, chatId, actorId, dialog); }
  finally { dialog.busy = false; }
}
export async function stockPurchaseText(ctx: FlowContext, chatId: number, actorId: string, dialog: StockPurchaseDialog, text: string) {
  if (dialog.busy) return;
  dialog.busy = true;
  try {
    switch (dialog.step) {
      case "material": await choose(ctx,chatId,actorId,dialog,"materials",text); break;
      case "cash": await choose(ctx,chatId,actorId,dialog,"cash"); break;
      case "article": await choose(ctx,chatId,actorId,dialog,"articles"); break;
      case "quantity":
        if (!positiveDecimalDraft(text,3)) { await ctx.reply(chatId,"Введите положительное количество (до 3 знаков после запятой):"); break; }
        dialog.input.quantity = text; dialog.step = "cash"; await choose(ctx,chatId,actorId,dialog,"cash"); break;
      case "price":
        if (!positiveDecimalDraft(text,2)) { await ctx.reply(chatId,"Введите положительную цену единицы (до 2 знаков после запятой):"); break; }
        dialog.input.unitPrice = text; dialog.step = "article"; await choose(ctx,chatId,actorId,dialog,"articles"); break;
      case "rate": {
        const automatic = ["авто","auto","—","-"].includes(text.toLowerCase());
        const rate = Number(text.replace(",","."));
        if (!automatic && (!Number.isFinite(rate) || rate <= 0)) { await ctx.reply(chatId,"Укажите положительный курс или «авто»:"); break; }
        dialog.input.rate = automatic ? undefined : rate; dialog.input.rateDate = undefined;
        if (dialog.retryRate) { dialog.retryRate = false; await confirm(ctx,chatId,actorId,dialog); break; }
        dialog.step = "comment";
        await ctx.reply(chatId,"Комментарий («—» — без комментария):",[cancel]); break;
      }
      case "comment":
        dialog.input.comment = ["—","-"].includes(text) ? undefined : text;
        dialog.step = "document";
        await ctx.reply(chatId,"Отчетный документ (необязательно): отправьте файл или фото либо выберите «Без документа».",[skipDocument(dialog),cancel]); break;
      default: await ctx.reply(chatId,"Выберите вариант кнопкой или отмените операцию.",[cancel]);
    }
  } finally { dialog.busy = false; }
}
export async function stockPurchaseCallback(ctx: FlowContext, chatId: number, actorId: string, dialog: StockPurchaseDialog | undefined, args: string[]) {
  if (!dialog || args[0] !== dialog.input.clientMutationId) { await ctx.reply(chatId,"Эта кнопка устарела. Начните заново: /закупка"); return; }
  if (dialog.busy) return;
  dialog.busy = true;
  try {
    if (args[1] === "pick") {
      const item=dialogChoice(dialog.choiceToken,dialog.choices,args[2],args[3]);
      if (!["material","cash","article"].includes(dialog.step) || !item) { await ctx.reply(chatId,"Выбор устарел — используйте последние кнопки."); return; }
      dialog.choiceToken = undefined; dialog.choices = undefined;
      if (dialog.step === "material") {
        dialog.input.materialId = item.id; dialog.materialLabel = item.label; dialog.unit = item.unit;
        dialog.step = "quantity"; await ctx.reply(chatId,`Количество (${item.unit ?? "ед."}):`,[cancel]);
      } else if (dialog.step === "cash") {
        if (!item.currency) { await ctx.reply(chatId,"У кассы не указана валюта — выберите кассу заново."); await choose(ctx,chatId,actorId,dialog,"cash"); return; }
        dialog.input.cashAccountId = item.id; dialog.input.currency = item.currency; dialog.cashLabel = item.label;
        dialog.step = "price"; await ctx.reply(chatId,`Цена одной единицы, ${item.currency}:`,[cancel]);
      } else {
        dialog.input.expenseArticleId = item.id; dialog.articleLabel = item.label;
        dialog.step = dialog.input.currency === "BYN" ? "comment" : "rate";
        await ctx.reply(chatId,dialog.step === "rate" ? `Курс BYN за 1 ${dialog.input.currency} или «авто» для НБ РБ:` : "Комментарий («—» — без комментария):",[cancel]);
      }
      return;
    }
    if (args[1] === "nodoc" && dialog.step === "document") { dialog.documentAttempt = undefined; await confirm(ctx,chatId,actorId,dialog); return; }
    if (args[1] === "docretry" && dialog.step === "document" && dialog.documentAttempt && args[2] === attemptToken(dialog.documentAttempt)) {
      await uploadDocument(ctx,chatId,actorId,dialog); return;
    }
    if (args[1] === "quote" && dialog.step === "quote") { await confirm(ctx,chatId,actorId,dialog); return; }
    if (args[1] === "rate" && dialog.step === "quote" && dialog.input.currency !== "BYN") { dialog.step="rate"; dialog.retryRate=true; await ctx.reply(chatId,`Курс BYN за 1 ${dialog.input.currency}:`,[cancel]); return; }
    if (args[1] !== "ok" || dialog.step !== "confirm" || !dialog.quote) { await ctx.reply(chatId,"Сначала завершите ввод закупки."); return; }
    try {
      const response = await crm.createStockReceipt(actorId,dialog.input);
      if (response.ok) {
        if (ctx.getDialog(chatId) === dialog) ctx.setDialog(chatId,null);
        await ctx.reply(chatId,`✅ Материал принят на склад. Из кассы списано ${formatMoney(dialog.quote.amount,dialog.quote.currency)}.`);
      } else await ctx.reply(chatId,`❌ ${response.error ?? "Приход не проведён"}. Повторите подтверждение или отмените операцию.`);
    } catch (error) {
      await ctx.reply(chatId,`❌ ${error instanceof CrmError ? error.message : "Ответ не получен"}. Повторите подтверждение: идентификатор закупки сохранён.`);
    }
  } finally { dialog.busy = false; }
}
