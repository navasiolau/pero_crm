import { randomUUID } from "node:crypto";
import { crm, CrmError, type DirectoryItem, type StockReceiptQuote } from "./crm";
import type { InlineButton } from "./tg";
import { formatMoney } from "./views";

type StockInput = { clientMutationId: string; materialId: string; quantity: string; unitPrice: string; currency: string; cashAccountId: string; expenseArticleId: string;
  rate?: number; rateDate?: string; comment?: string };
export type StockPurchaseDialog = {
  kind: "stockPurchase"; step: "material" | "quantity" | "cash" | "price" | "article" | "rate" | "comment" | "confirm";
  input: StockInput; materialLabel?: string; unit?: string; cashLabel?: string; articleLabel?: string;
  choices?: DirectoryItem[]; choiceToken?: string; quote?: StockReceiptQuote; busy?: boolean;
};
type FlowContext = {
  reply: (chatId: number, text: string, buttons?: InlineButton[][]) => Promise<void>;
  getDialog: (chatId: number) => unknown;
  setDialog: (chatId: number, dialog: StockPurchaseDialog | null) => void;
};
const cancel = [{ text: "❌ Отмена", callback_data: "cancel" }];
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
  dialog.choices = items; dialog.choiceToken = randomUUID().slice(0,8);
  if (!items.length) { await ctx.reply(chatId, type === "materials" ? "Материал не найден. Уточните название:" : "Нет доступных вариантов. Проверьте справочник в CRM.", [cancel]); return; }
  const label = type === "materials" ? "Материал:" : type === "cash" ? "Касса оплаты:" : "Статья расхода:";
  await ctx.reply(chatId, label, [...items.map((item,index) => [{ text: item.label + (item.currency ? ` · ${item.currency}` : ""),
    callback_data: `sp:${dialog.input.clientMutationId}:pick:${dialog.choiceToken}:${index}` }]), cancel]);
}
async function confirm(ctx: FlowContext, chatId: number, actorId: string, dialog: StockPurchaseDialog) {
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
  ].join("\n"), [[{ text: "✅ Оплатить и принять", callback_data: `sp:${dialog.input.clientMutationId}:ok` }], cancel]);
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
        if (!/^\d+(?:[.,]\d{1,3})?$/.test(text) || Number(text.replace(",",".")) <= 0) { await ctx.reply(chatId,"Введите положительное количество (до 3 знаков после запятой):"); break; }
        dialog.input.quantity = text; dialog.step = "cash"; await choose(ctx,chatId,actorId,dialog,"cash"); break;
      case "price":
        if (!/^\d+(?:[.,]\d{1,2})?$/.test(text) || Number(text.replace(",",".")) <= 0) { await ctx.reply(chatId,"Введите положительную цену единицы (до 2 знаков после запятой):"); break; }
        dialog.input.unitPrice = text; dialog.step = "article"; await choose(ctx,chatId,actorId,dialog,"articles"); break;
      case "rate": {
        const automatic = ["авто","auto","—","-"].includes(text.toLowerCase());
        const rate = Number(text.replace(",","."));
        if (!automatic && (!Number.isFinite(rate) || rate <= 0)) { await ctx.reply(chatId,"Укажите положительный курс или «авто»:"); break; }
        dialog.input.rate = automatic ? undefined : rate; dialog.input.rateDate = undefined; dialog.step = "comment";
        await ctx.reply(chatId,"Комментарий («—» — без комментария):",[cancel]); break;
      }
      case "comment":
        dialog.input.comment = ["—","-"].includes(text) ? undefined : text;
        await confirm(ctx,chatId,actorId,dialog); break;
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
      if (!["material","cash","article"].includes(dialog.step) || args[2] !== dialog.choiceToken || !/^\d+$/.test(args[3] ?? "")) { await ctx.reply(chatId,"Выбор устарел — используйте последние кнопки."); return; }
      const item = dialog.choices?.[Number(args[3])]; if (!item) return;
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
    if (args[1] === "quote" && dialog.step === "comment") { await confirm(ctx,chatId,actorId,dialog); return; }
    if (args[1] === "rate" && dialog.step === "comment" && dialog.input.currency !== "BYN") { dialog.step="rate"; await ctx.reply(chatId,`Курс BYN за 1 ${dialog.input.currency}:`,[cancel]); return; }
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
