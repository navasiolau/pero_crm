import { config } from "./config";
import { pendingFinanceCommand, submitFinanceCommand } from "./finance-checkpoint";
import { dialogChoices, dialogChoice } from "./dialog-choices";
import {randomUUID} from "node:crypto";
import { crm, CrmError, type ProjectRef,type ProjectBaseline } from "./crm";
import { tg, TgError, type InlineButton, type TgCallbackQuery, type TgMessage, type TgUpdate } from "./tg";
import { documentAttempt, uploadFinanceDocument, documentUploadError, hasUnresolvedDocumentAttempt, paymentReportDocumentInput, type DocumentAttempt, type ReportDocument } from "./finance-document-upload";
import { startStockMovement, stockMovementText, stockMovementCallback, type StockMovementDialog } from "./stock-movement-dialog";
import { startStockPurchase, stockPurchaseText, stockPurchaseCallback, stockPurchaseDocument, type StockPurchaseDialog } from "./stock-purchase-dialog";
import {
  CURRENCIES,
  FINANCE_ROLES,
  WAREHOUSE_ROLES,
  STAGE_LABELS,
  STAGE_ORDER,
  formatMoney,
  hasAny,
  parseAmount,
  projectCardText,
  rolesLabel,
} from "./views";

// Движок бота: роутер команд/кнопок + конечные автоматы диалогов.
// Состояние диалогов — в памяти процесса (контейнер один, рестарт просто
// сбрасывает начатые диалоги). Непривязанные чаты игнорируются; пользователям
// без MANAGER_ROLES бот отвечает отказом (решение владельца).

interface Session {
  userId: string;
  name: string;
  roles: string[];
  botAllowed: boolean;
  binding?: string;
}

type Dialog =
  | StockPurchaseDialog
  | StockMovementDialog
  | {
      kind: "newProject";
      step: "title" | "client" | "manager";
      title: string;
      clientId?: string;
      managerId?: string | null;
    }
  | {
      kind: "payment";
      direction: "INCOME" | "EXPENSE";
      step: "project" | "amount" | "currency" | "cash" | "article" | "comment" | "document" | "confirm" | "paidAt" | "rate";
      clientMutationId: string;
      projectSelected: boolean;
      choices?: ProjectRef[];
      choiceToken?: string;
      paidAt?: string;
      rate?: number;
      reportDocument?: ReportDocument;
      reportDocuments?: ReportDocument[];
      documentAttempt?: DocumentAttempt;
      busy?: boolean;
      projectId?: string | null;
      projectNumber?: string;
      projectCurrency?: string;
      amount?: number;
      currency?: string;
      cashAccountId?: string;
      cashLabel?: string;
      articleId?: string;
      articleLabel?: string;
      comment?: string;
    }
  | {
      kind: "stage";
      projectId: string;
      projectNumber: string;
      expectedStage: string; clientMutationId: string;
      step:
        | "refusalReason"
        | "refusalComment";
      refusalReason?: string;
    }
  | {
      kind: "edit";
      projectId: string;
      projectNumber: string;
      field: "title" | "address" | "manager";
      expectedAddress?: string | null;
      expectedBaseline?: ProjectBaseline;
      clientMutationId?: string; submittedValue?: string;
    };

const stageMenus=new Map<string,{projectId:string;projectNumber:string;expectedStage:string;token:string;mutations:Record<string,string>}>();
const financeProjectMenus = new Map<number, { token: string; projects: ProjectRef[] }>();
const dialogs = new Map<string, Dialog>();
const observedActor = new Map<string, { userId: string; binding?: string }>();
const callbackMessages = new Map<string, Map<number, Set<string>>>();
const noticeAt = new Map<string, number>();
const FINANCE_CALLBACK_ACTIONS = new Set(["payin", "payout", "payproj", "paygeneral", "paylist", "payoptions", "cur", "cash", "art", "nocomment", "payok", "docretry", "doccontinue", "docexclude", "sp"]);

function getDialog(chatId: number): Dialog | undefined {
  return dialogs.get(String(chatId));
}
function setDialog(chatId: number, dialog: Dialog | null): void {
  if (dialog) dialogs.set(String(chatId), dialog);
  else dialogs.delete(String(chatId));
}

async function getSession(chatId: string): Promise<Session | null> {
  const response = await crm.session(chatId);
  if (!response.found || !response.user) {
    dropSession(chatId);
    return null;
  }
  const previous = observedActor.get(chatId);
  if (previous?.userId !== response.user.id || previous?.binding !== response.binding) dropSession(chatId);
  const session: Session = {
    userId: response.user.id,
    name: response.user.name,
    roles: response.user.roles,
    botAllowed: response.user.botAllowed,
    binding: response.binding,
  };
  observedActor.set(chatId, { userId: session.userId, binding: session.binding });
  return session;
}

function dropSession(chatId: string): void {
  observedActor.delete(chatId);
  callbackMessages.delete(chatId);
  dialogs.delete(chatId);
  financeProjectMenus.delete(Number(chatId));
}

const CANCEL_BUTTON: InlineButton = { text: "❌ Отмена", callback_data: "cancel" };

async function reply(
  chatId: number,
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  try {
    const key = String(chatId);
    const observed = observedActor.get(key);
    const sent = await tg.sendMessage(chatId, text, buttons);
    if (observed?.binding && buttons && observedActor.get(key) === observed) {
      const callbacks = buttons.flat().flatMap(button => button.callback_data ? [button.callback_data] : []);
      if (callbacks.length) {
        const messages = callbackMessages.get(key) ?? new Map<number, Set<string>>();
        messages.set(sent.message_id, new Set(callbacks));
        if (messages.size > 100) messages.delete(messages.keys().next().value!);
        callbackMessages.set(key, messages);
      }
    }
  } catch (e) {
    // Клавиатура не прошла (например, битая кнопка) — повторяем без неё,
    // чтобы пользователь не оставался без ответа
    if (buttons && e instanceof TgError) {
      try {
        await tg.sendMessage(chatId, text);
        return;
      } catch (e2) {
        console.error("[engine] sendMessage (без кнопок):", (e2 as Error).message);
        return;
      }
    }
    console.error("[engine] sendMessage:", (e as Error).message);
  }
}

function buttonsRow(items: InlineButton[], perRow = 2): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow));
  }
  return rows;
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  if (chatId <= 0 || message.from?.id !== chatId) return;
  const text = message.text?.trim() ?? "";
  const { cmd, args } = parseCommand(text);

  // /start <код> работает без сессии (привязка доступна любой роли).
  // Отвязка через бота НЕ предусмотрена (решение владельца): только из CRM
  // (профиль) или администратором в управлении пользователями.
  if (cmd === "/start" && args[0]) {
    await handleLinkCode(chatId, args[0], message.from?.username);
    return;
  }

  const session = await getSession(String(chatId));
  if (!session) return; // непривязанные — молча

  if (!session.botAllowed) {
    const last = noticeAt.get(String(chatId)) ?? 0;
    if (Date.now() - last > 60_000) {
      noticeAt.set(String(chatId), Date.now());
      await reply(
        chatId,
        `${session.name}, бот доступен только менеджерам, администраторам, директорам, бухгалтерам и снабженцам.`,
      );
    }
    return;
  }

  if (message.document || message.photo?.length) {
    await paymentDocumentMessage(chatId, message);
    return;
  }
  if (!message.text) return;

  if (cmd !== "") {
    await handleCommand(chatId, session, cmd, args);
    return;
  }

  const dialog = getDialog(chatId);
  if (dialog) {
    try { await handleDialogText(chatId, session, dialog, text); }
    catch(error){if(error instanceof CrmError)await reply(chatId,`❌ ${error.message}. Повторите ввод: исходные данные сохранены.`);else throw error;}
    return;
  }
  await reply(chatId, "Команды бота — /help");
}

function parseCommand(text: string): { cmd: string; args: string[] } {
  const parts = text.split(/\s+/);
  const first = parts[0] ?? "";
  const cmd = first.startsWith("/")
    ? first.replace(/@[\w_]+$/, "").toLowerCase()
    : "";
  return { cmd, args: parts.slice(1) };
}

// ─── Привязка / отвязка ──────────────────────────────────────────────────────

async function handleLinkCode(
  chatId: number,
  code: string,
  username?: string,
): Promise<void> {
  const result = await crm.link(code, String(chatId), username);
  if (!result.ok || !result.user) {
    await reply(chatId, result.error ?? "Не удалось привязать аккаунт");
    return;
  }
  dropSession(String(chatId));
  const who = `${result.user.name} · ${rolesLabel(result.user.roles)}`;
  if (!result.user.botAllowed) {
    await reply(
      chatId,
      `Аккаунт привязан: ${who}.\nБот доступен только менеджерам, администраторам, директорам, бухгалтерам и снабженцам — команды неактивны.`,
    );
    return;
  }
  await reply(chatId, `✅ Привязано: ${who}\n\nСписок команд — /help`, financeWorkspaceButtons(result.user.roles));
}

// ─── Команды ─────────────────────────────────────────────────────────────────

async function handleCommand(
  chatId: number,
  session: Session,
  cmd: string,
  args: string[],
): Promise<void> {
  switch (cmd) {
    case "/повтор":
    case "/retry": {
      if (!hasAny(session.roles, FINANCE_ROLES)) return;
      const pending = pendingFinanceCommand(chatId, session.userId);
      if (!pending) {
        await reply(chatId, "Нет ожидающей подтверждения операции для вашего аккаунта.");
        return;
      }
      try {
        const result = await submitFinanceCommand(chatId, pending);
        if (result.ok) setDialog(chatId, null);
        await reply(chatId, result.ok ? "✅ Операция подтверждена в CRM." : `❌ ${result.error ?? "Результат неизвестен"}`);
      } catch {
        await reply(chatId, "Подтверждение недоступно. Позже повторите /повтор.");
      }
      return;
    }
    case "/выдача": case "/stockout": case "/возврат": case "/stockreturn": case "/инвприход": case "/stockinventory": {
      const current=await getSession(String(chatId));
      if(chatId<=0||!current?.botAllowed||!hasAny(current.roles,WAREHOUSE_ROLES)){await reply(chatId,"Складские операции доступны складским ролям в личном чате.");return;}
      const kind=["/выдача","/stockout"].includes(cmd)?"EXPENSE":["/возврат","/stockreturn"].includes(cmd)?"RETURN":"INCOME";
      await startStockMovement({reply,getDialog,setDialog},chatId,kind);return;
    }
    case "/закупка":
    case "/stockin": {
      const current = await getSession(String(chatId));
      if (chatId <= 0 || !current?.botAllowed || !hasAny(current.roles,FINANCE_ROLES)) { await reply(chatId,"Закупки доступны финансовым ролям в личном чате с ботом."); return; }
      if (await blockPendingFinance(chatId, current)) return;
      await startStockPurchase({ reply, getDialog, setDialog },chatId); return;
    }
    case "/финансы":
    case "/finance": {
      const buttons = financeWorkspaceButtons(session.roles);
      await reply(chatId, buttons ? "Рабочее пространство CRM" : "Финансы в Telegram недоступны.", buttons);
      return;
    }
    case "/start":
    case "/help": {
      await reply(chatId, helpText(session), financeWorkspaceButtons(session.roles));
      return;
    }
    case "/новый":
    case "/new": {
      if (!hasAny(session.roles, ["ADMIN", "DIRECTOR", "MANAGER"])) { await reply(chatId, "Недостаточно прав"); return; }
      setDialog(chatId, {
        kind: "newProject",
        step: "title",
        title: "",
      });
      await reply(
        chatId,
        "Создание проекта.\n1/3 Название заказа:",
        [[CANCEL_BUTTON]],
      );
      return;
    }
    case "/проекты":
    case "/projects": {
      const result = await crm.projects(session.userId, args.join(" ") || undefined);
      const projects = result.projects ?? [];
      if (projects.length === 0) {
        await reply(chatId, "Проектов не найдено.");
        return;
      }
      if (!hasAny(session.roles, ["ADMIN", "DIRECTOR", "MANAGER"])) {
        const token = randomUUID();
        financeProjectMenus.set(chatId, { token, projects: projects.slice(0, 10) });
        await reply(chatId, "Последние проекты. Чтобы найти другой, используйте /приход или /расход.", projects.slice(0, 10).map((project, index) => [
          { text: `П-${project.number} ${project.title}`.slice(0, 40), callback_data: `paylist:${token}:${index}` },
        ]));
        return;
      }
      await reply(
        chatId,
        "Последние проекты:",
        buttonsRow(
          projects.map((project) => ({
            text: `П-${project.number} ${project.title}`.slice(0, 64),
            callback_data: `proj:${project.id}`,
          })),
        ),
      );
      return;
    }
    case "/проект":
    case "/project": {
      if (!hasAny(session.roles, ["ADMIN", "DIRECTOR", "MANAGER"])) { await reply(chatId, "Карточка проекта недоступна. Для платежа: /приход или /расход"); return; }
      if (!args[0]) {
        await reply(chatId, "Укажите номер: /проект 205");
        return;
      }
      const found = await findProject(session.userId, args[0]);
      if (!found) {
        await reply(chatId, `Проект «${args[0]}» не найден. Поиск: /проекты`);
        return;
      }
      await showProjectCard(chatId, session, found.id);
      return;
    }
    case "/приход":
    case "/in": {
      await startPayment(chatId, session, "INCOME", args);
      return;
    }
    case "/расход":
    case "/out": {
      await startPayment(chatId, session, "EXPENSE", args);
      return;
    }
    default:
      await reply(chatId, "Неизвестная команда. Список — /help");
  }
}

function financeWorkspaceButtons(roles: string[]): InlineButton[][] | undefined {
  const url = config.financeWorkspaceUrl;
  return url && hasAny(roles, FINANCE_ROLES) ? [[{ text: "Финансы", web_app: { url } }]] : undefined;
}

function helpText(session: Session): string {
  const lines = ["Команды бота:"];
  if (hasAny(session.roles, ["ADMIN", "DIRECTOR", "MANAGER"])) lines.push(
    "/новый — создать проект",
    "/проект <номер> — карточка проекта (этап, реквизиты, платежи)",
    "/проекты — последние проекты",
  );
  if (hasAny(session.roles, FINANCE_ROLES)) {
    if (config.financeWorkspaceUrl) lines.push("/финансы — открыть рабочее пространство");
    lines.push(
      "/приход [номер] [сумма] — приход по проекту или организации",
      "/расход [номер] [сумма] — расход по проекту или организации",
      "/закупка — приход материала с оплатой из кассы",
      "/повтор — проверить незавершённое подтверждение",
    );
  }
  if (hasAny(session.roles, FINANCE_ROLES) && !hasAny(session.roles, ["ADMIN", "DIRECTOR", "MANAGER"])) lines.push("/проекты [поиск] — найти проект для платежа");
  if(hasAny(session.roles,WAREHOUSE_ROLES))lines.push("/выдача — выдать материал на изделие","/возврат — вернуть материал по исходной выдаче","/инвприход — инвентарный приход без кассы");
  lines.push("Отвязать бота — в CRM: меню профиля → Telegram");
  return lines.join("\n");
}

async function findProject(
  actorId: string,
  query: string,
): Promise<ProjectRef | null> {
  const result = await crm.projects(actorId, query);
  const projects = result.projects ?? [];
  const exact = projects.find((project) => project.number === query);
  return exact ?? projects[0] ?? null;
}

// ─── Карточка проекта ────────────────────────────────────────────────────────

async function showProjectCard(
  chatId: number,
  session: Session,
  projectId: string,
): Promise<void> {
  const result = await crm.project(session.userId, projectId);
  if (!result.ok || !result.project) {
    await reply(chatId, result.error ?? "Проект не найден");
    return;
  }
  const buttons: InlineButton[][] = [
    [
      { text: "🔀 Сменить статус", callback_data: `stage:${projectId}` },
      { text: "✏️ Реквизиты", callback_data: `edit:${projectId}` },
    ],
  ];
  if (hasAny(session.roles, FINANCE_ROLES)) {
    buttons.push([
      { text: "➕ Приход", callback_data: `payin:${projectId}` },
      { text: "➖ Расход", callback_data: `payout:${projectId}` },
    ]);
  }
  buttons.push([{ text: "🔄 Обновить", callback_data: `proj:${projectId}` }]);
  await reply(chatId, projectCardText(result.project, result.finance ?? null), buttons);
}

// ─── Диалоги: текстовый ввод ─────────────────────────────────────────────────

async function handleDialogText(
  chatId: number,
  session: Session,
  dialog: Dialog,
  text: string,
): Promise<void> {
  if(dialog.kind==="stockMovement"){
    const current=await getSession(String(chatId));
    if(chatId<=0||!current?.botAllowed||!hasAny(current.roles,WAREHOUSE_ROLES)){await reply(chatId,"Недостаточно прав для склада");return;}
    await stockMovementText({reply,getDialog,setDialog},chatId,current.userId,dialog,text);return;
  }
  if (dialog.kind === "stockPurchase") {
    const current = await getSession(String(chatId));
    if (chatId <= 0 || !current?.botAllowed || !hasAny(current.roles,FINANCE_ROLES)) { await reply(chatId,"Недостаточно прав для закупки"); return; }
    await stockPurchaseText({ reply, getDialog, setDialog },chatId,current.userId,dialog,text); return;
  }
  if (dialog.kind === "newProject") {
    await newProjectText(chatId, session, dialog, text);
    return;
  }
  if (dialog.kind === "payment") {
    await paymentText(chatId, session, dialog, text);
    return;
  }
  if (dialog.kind === "stage") {
    await stageText(chatId, session, dialog, text);
    return;
  }
  await editText(chatId, session, dialog, text);
}

// — Создание проекта —

async function newProjectText(
  chatId: number,
  session: Session,
  dialog: Extract<Dialog, { kind: "newProject" }>,
  text: string,
): Promise<void> {
  switch (dialog.step) {
    case "title": {
      dialog.title = text;
      dialog.step = "client";
      setDialog(chatId, dialog);
      await reply(chatId, "2/3 Клиент — введите имя/фамилию или телефон для поиска:", [
        [CANCEL_BUTTON],
      ]);
      return;
    }
    case "client": {
      const result = await crm.directory(session.userId, "clients", text);
      const items = result.items ?? [];
      if (items.length === 0) {
        await reply(chatId, "Клиент не найден — уточните запрос:");
        return;
      }
      setDialog(chatId, dialog); // выбор по кнопкам cli:<id>
      await reply(
        chatId,
        "Найденные клиенты:",
        buttonsRow(
          items.map((item) => ({
            text: item.label,
            callback_data: `cli:${item.id}`,
          })),
          1,
        ),
      );
      return;
    }
    default:
      setDialog(chatId, null);
  }
}

// — Платёж (приход/расход) —

async function blockPendingFinance(chatId: number, session: Session) {
  const pending = pendingFinanceCommand(chatId, session.userId);
  if (!pending) return false;
  await reply(chatId, "Сначала проверьте незавершённую операцию командой /повтор.");
  return true;
}

async function startPayment(
  chatId: number,
  session: Session,
  direction: "INCOME" | "EXPENSE",
  args: string[],
): Promise<void> {
  if (chatId <= 0) { await reply(chatId, "Финансовые операции доступны в личном чате с ботом."); return; }
  if (!hasAny(session.roles, FINANCE_ROLES)) {
    await reply(
      chatId,
      "Платежи доступны администратору, директору, бухгалтеру и снабженцу.",
    );
    return;
  }
  if (await blockPendingFinance(chatId, session)) return;
  const dialog: Extract<Dialog, { kind: "payment" }> = {
    kind: "payment",
    direction,
    step: "project",
    clientMutationId: randomUUID(),
    projectSelected: false,
    ...(direction === "EXPENSE" ? { reportDocuments: [] } : {}),
  };
  const label = direction === "INCOME" ? "Приход" : "Расход";
  setDialog(chatId, dialog);
  if (args[1]) {
    const amount = parseAmount(args[1]);
    if (amount === null) {
      await reply(chatId, "Сумма не распознана (пример: 4000 или 4000,50)");
      return;
    }
    dialog.amount = amount;
  }
  if (args[0]) {
    await searchPaymentProject(chatId, session, dialog, args[0]);
    return;
  }
  await reply(chatId, `${label}. Укажите проект (номер или название) либо выберите общий ${label.toLowerCase()}:`, [
    [{ text: "Без проекта", callback_data: `paygeneral:${dialog.clientMutationId}` }],
    [CANCEL_BUTTON],
  ]);
}

async function selectPaymentProject(chatId: number, session: Session, dialog: Extract<Dialog, { kind: "payment" }>, project: ProjectRef) {
  dialog.projectId = project.id;
  dialog.projectSelected = true;
  dialog.projectNumber = project.number;
  dialog.projectCurrency = project.currency;
  await nextPaymentStep(chatId, session, dialog, false);
}

async function searchPaymentProject(chatId: number, session: Session, dialog: Extract<Dialog, { kind: "payment" }>, text: string) {
  dialog.choiceToken = undefined;
  const input = text.replace(/^[пП][- ](?=\d)/, "");
  const { projects = [] } = await crm.projects(session.userId, input);
  const exact = projects.find(project => project.number === input);
  if (exact || projects.length === 1) {
    await selectPaymentProject(chatId, session, dialog, exact ?? projects[0]);
    return;
  }
  if (!projects.length) {
    await reply(chatId, "Проект не найден. Уточните номер или название:", [[CANCEL_BUTTON]]);
    return;
  }
  dialog.choices = projects.slice(0, 8);
  const choices = dialogChoices("payproj", dialog.clientMutationId, dialog.choices.map(project => ({
    label: `П-${project.number} ${project.title}`.slice(0, 64),
  })));
  dialog.choiceToken = choices.token;
  await reply(chatId, "Выберите проект или уточните поиск:", [...choices.buttons, [CANCEL_BUTTON]]);
}

function paymentContext(dialog: Extract<Dialog, { kind: "payment" }>): string {
  return dialog.projectId ? `П-${dialog.projectNumber}` : "Организация";
}

async function paymentText(
  chatId: number,
  session: Session,
  dialog: Extract<Dialog, { kind: "payment" }>,
  text: string,
): Promise<void> {
  if (dialog.step === "project") {
    await searchPaymentProject(chatId, session, dialog, text);
    return;
  }
  if (dialog.step === "paidAt") {
    if (!/^(?:\d{4}-\d{2}-\d{2}|авто)$/i.test(text)) {
      await reply(chatId, "Введите дату в формате ГГГГ-ММ-ДД или «авто».");
      return;
    }
    const automatic = text.toLowerCase() === "авто";
    if (!automatic) {
      const date = new Date(text);
      if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== text) {
        await reply(chatId, "Проверьте календарную дату.");
        return;
      }
    }
    dialog.paidAt = automatic ? undefined : text;
    await confirmPayment(chatId, session, dialog);
    return;
  }
  if (dialog.step === "rate") {
    const automatic = text.toLowerCase() === "авто";
    const rate = Number(text.replace(",", "."));
    if (!automatic && (!/^\d+(?:[.,]\d+)?$/.test(text) || !Number.isFinite(rate) || rate <= 0)) {
      await reply(chatId, "Введите положительный курс в BYN или «авто».");
      return;
    }
    dialog.rate = automatic ? undefined : rate;
    await confirmPayment(chatId, session, dialog);
    return;
  }
  if (dialog.step === "amount") {
    const amount = parseAmount(text);
    if (amount === null) {
      await reply(chatId, "Сумма не распознана (пример: 4000 или 4000,50):");
      return;
    }
    dialog.amount = amount;
    await nextPaymentStep(chatId, session, dialog, false);
    return;
  }
  if (dialog.step === "comment") {
    dialog.comment = text === "-" || text === "—" ? undefined : text;
    setDialog(chatId, dialog);
    await confirmPayment(chatId, session, dialog);
    return;
  }
  if (dialog.step === "document") await reply(chatId, "Отправьте отчётный документ файлом или фотографией.", [[CANCEL_BUTTON]]);
}

async function paymentDocumentMessage(chatId: number, message: TgMessage) {
  if (!message.from || message.from.id !== chatId || chatId <= 0) return;
  const session = await getSession(String(chatId));
  const dialog = getDialog(chatId);
  if (!session || !hasAny(session.roles, FINANCE_ROLES)) { await reply(chatId, "Недостаточно прав для финансовых документов"); return; }
  if (dialog?.kind === "stockPurchase") {
    await stockPurchaseDocument({ reply, getDialog, setDialog }, chatId, session.userId, dialog, message); return;
  }
  if (dialog?.kind !== "payment" || dialog.direction !== "EXPENSE" || !["document", "comment"].includes(dialog.step)) {
    await reply(chatId, "Сначала начните оформление расхода: /расход"); return;
  }
  if (dialog.busy) return;
  if (dialog.step === "comment") { dialog.comment = message.caption?.trim() || undefined; dialog.step = "document"; }
  const attempt = documentAttempt(message, dialog.documentAttempt);
  if (dialog.documentAttempt && attempt?.clientMutationId !== dialog.documentAttempt.clientMutationId) {
    await reply(chatId, "Сначала повторите или исключите неподтверждённый файл."); return;
  }
  dialog.documentAttempt = attempt;
  await uploadPaymentDocument(chatId, session, dialog);
}

async function uploadPaymentDocument(chatId: number, session: Session, dialog: Extract<Dialog, { kind: "payment" }>) {
  const attempt = dialog.documentAttempt;
  if (!attempt || dialog.busy) return;
  dialog.busy = true;
  try {
    const document = await uploadFinanceDocument(session.userId, attempt);
    if (getDialog(chatId) !== dialog) return;
    if (dialog.reportDocuments !== undefined) {
      if (!dialog.reportDocuments.some(row => row.id === document.id)) dialog.reportDocuments.push(document);
      dialog.documentAttempt = undefined;
      await paymentDocumentList(chatId, dialog);
    } else {
      // Старый уже начатый диалог сохраняет одиночный денежный payload.
      dialog.reportDocument = document;
      dialog.documentAttempt = undefined;
      await confirmPayment(chatId, session, dialog);
    }
  } catch (error) {
    if (getDialog(chatId) !== dialog) return;
    const message = documentUploadError(error);
    await reply(chatId, `❌ ${message}. Данные расхода сохранены.`, [
      [{ text: "Повторить загрузку", callback_data: `docretry:${attempt.clientMutationId}` }],
      [{ text: "Исключить этот файл", callback_data: `docexclude:${attempt.clientMutationId}` }], [CANCEL_BUTTON]]);
  } finally { dialog.busy = false; }
}

function paymentDocuments(dialog: Extract<Dialog, { kind: "payment" }>) {
  return dialog.reportDocuments ?? (dialog.reportDocument ? [dialog.reportDocument] : []);
}
async function paymentDocumentList(chatId: number, dialog: Extract<Dialog, { kind: "payment" }>) {
  dialog.step = "document";
  const documents = paymentDocuments(dialog);
  await reply(chatId, `Отчётные документы (${documents.length}):\n${documents.map((file, index) => `${index + 1}. ${file.fileName}`).join("\n")}\nОтправьте ещё файл или продолжите.`, [
    ...(documents.length && !dialog.documentAttempt ? [[{ text: "Продолжить", callback_data: `doccontinue:${dialog.clientMutationId}` }]] : []),
    [CANCEL_BUTTON],
  ]);
}

// Продвижение диалога платежа к следующему шагу ввода; amountIsSet —
// сумма уже введена (не показываем подсказку про неё).
async function nextPaymentStep(
  chatId: number,
  session: Session,
  dialog: Extract<Dialog, { kind: "payment" }>,
  amountIsSet: boolean,
): Promise<void> {
  const label = dialog.direction === "INCOME" ? "Приход" : "Расход";
  if (!dialog.amount) {
    dialog.step = "amount";
    setDialog(chatId, dialog);
    await reply(chatId, `${label} · ${paymentContext(dialog)}. Сумма:`, [
      [CANCEL_BUTTON],
    ]);
    return;
  }
  void amountIsSet;
  dialog.step = "currency";
  setDialog(chatId, dialog);
  const currency = dialog.projectCurrency ?? "BYN";
  await reply(
    chatId,
    `${label} · ${paymentContext(dialog)} · ${formatMoney(dialog.amount, currency)}\nВалюта операции:`,
    [
      [
        { text: `✅ ${currency}`, callback_data: `cur:${currency}` },
        ...CURRENCIES.filter((c) => c !== currency).map(
          (c) => ({ text: c, callback_data: `cur:${c}` }) as InlineButton,
        ),
      ],
      [CANCEL_BUTTON],
    ],
  );
}

async function confirmPayment(
  chatId: number,
  session: Session,
  dialog: Extract<Dialog, { kind: "payment" }>,
): Promise<void> {
  if (dialog.direction === "EXPENSE" && (!paymentDocuments(dialog).length || hasUnresolvedDocumentAttempt(dialog))) {
    dialog.step = "document"; setDialog(chatId, dialog);
    await reply(chatId, "Отчетный документ: отправьте файл или фотографию (до 20 МБ).", [[CANCEL_BUTTON]]); return;
  }
  dialog.step = "confirm";
  const label = dialog.direction === "INCOME" ? "Приход" : "Расход";
  const lines = [
    `❗ Подтвердите: ${label}`,
    dialog.projectId ? `Проект: П-${dialog.projectNumber}` : `Контекст: общий ${label.toLowerCase()} организации`,
    `Сумма: ${formatMoney(dialog.amount ?? 0, dialog.currency ?? "BYN")}`,
    `Касса: ${dialog.cashLabel ?? "—"}`,
  ];
  if (dialog.direction === "EXPENSE") {
    lines.push(`Статья: ${dialog.articleLabel ?? "—"}`);
    lines.push(`Отчетные документы: ${paymentDocuments(dialog).map(file => file.fileName).join(", ") || "—"}`);
  }
  lines.push(`Дата оплаты: ${dialog.paidAt ?? "сегодня"}`);
  if (dialog.currency !== "BYN") lines.push(`Курс BYN: ${dialog.rate ?? "НБ РБ"}`);
  lines.push(`Комментарий: ${dialog.comment ?? "—"}`);
  setDialog(chatId, dialog);
  await reply(chatId, lines.join("\n"), [
    [
      { text: "Дата оплаты", callback_data: `payoptions:${dialog.clientMutationId}:date` },
      ...(dialog.currency === "BYN" ? [] : [{ text: "Курс", callback_data: `payoptions:${dialog.clientMutationId}:rate` }]),
    ],
    [
      { text: "✅ Создать", callback_data: `payok:${dialog.clientMutationId}` },
      { text: "❌ Отмена", callback_data: "cancel" },
    ],
  ]);
}

// — Смена этапа —

async function stageText(
  chatId: number,
  session: Session,
  dialog: Extract<Dialog, { kind: "stage" }>,
  text: string,
): Promise<void> {
  switch (dialog.step) {
    case "refusalReason":
      if(!text.trim()){await reply(chatId,"Укажите причину отказа:");return;}
      dialog.refusalReason = text;
      dialog.step = "refusalComment";
      setDialog(chatId, dialog);
      await reply(chatId, "Комментарий к отказу («—» — пропустить):");
      return;
    case "refusalComment": {
      const result = await crm.changeStage(session.userId, dialog.projectId, "REFUSED", {
        refusalReason: dialog.refusalReason ?? "",
        refusalComment: text === "—" || text === "-" ? "" : text,
      },dialog.expectedStage,dialog.clientMutationId);
      if(result.ok)setDialog(chatId, null);
      await reply(
        chatId,
        result.ok
          ? `✅ Статус: ${STAGE_LABELS.REFUSED} · П-${dialog.projectNumber}`
          : `❌ ${result.error}`,
      );
      return;
    }
  }
}

// — Реквизиты —

async function editText(
  chatId: number,
  session: Session,
  dialog: Extract<Dialog, { kind: "edit" }>,
  text: string,
): Promise<void> {
  if(!dialog.expectedBaseline){await reply(chatId,"Откройте редактирование заново: исходные значения отсутствуют");return;}
  let input: Record<string, unknown>;
  switch (dialog.field) {
    case "title":
      input = { title: text };
      break;
    case "address":
      if (!Object.prototype.hasOwnProperty.call(dialog, "expectedAddress")) {
        setDialog(chatId, null); await reply(chatId, "Откройте адрес проекта заново: исходное значение отсутствует."); return;
      }
      input = { address: text === "-" || text === "—" ? null : text, baseline: dialog.expectedBaseline };
      break;
    default:
      setDialog(chatId, null);
      return;
  }
  const result = await saveProjectEdit(session,dialog,dialog.field,input[dialog.field] as string|null);
  if(result.ok)setDialog(chatId, null);
  await reply(
    chatId,
    result.ok
      ? `✅ Сохранено · П-${dialog.projectNumber}`
      : `❌ ${result.error ?? "Не удалось сохранить"}`,
  );
}

/** ID принадлежит конкретному введённому значению, а не каждой попытке доставки. */
async function saveProjectEdit(session:Session,dialog:Extract<Dialog,{kind:"edit"}>,field:"title"|"address"|"managerId",value:string|null){
 if(!dialog.expectedBaseline||!dialog.clientMutationId)return{ok:false,error:"Откройте редактирование заново: исходные значения отсутствуют"};
 const serialized=JSON.stringify({field,value});
 if(dialog.submittedValue!==undefined&&dialog.submittedValue!==serialized)dialog.clientMutationId=randomUUID();
 dialog.submittedValue=serialized;
 const result=await crm.patchProject(session.userId,dialog.projectId,{projectId:dialog.projectId,field,value,expectedValue:dialog.expectedBaseline[field],clientMutationId:dialog.clientMutationId});
 if(result.kind==='conflict')return{...result,error:`${result.error??'Данные изменены другим пользователем'}. Откройте редактирование заново для подтверждения актуальных данных.`};
 return result;
}
// ─── Кнопки (callback queries) ───────────────────────────────────────────────

async function handleCallback(query: TgCallbackQuery): Promise<void> {
  const chatId = query.message.chat.id;
  if (chatId <= 0 || query.from.id !== chatId) return;
  try {
    await tg.answerCallbackQuery(query.id);
  } catch {
    // не критично
  }
  const data = query.data ?? "";
  const [action, ...rest] = data.split(":");

  const financial = FINANCE_CALLBACK_ACTIONS.has(action), warehouse = action === "sw";
  const session = await getSession(String(chatId));
  if (!session) return;
  if (!session.botAllowed) return;
  if (session.binding && !callbackMessages.get(String(chatId))?.get(query.message.message_id)?.has(data)) {
    await reply(chatId, "Кнопка устарела. Откройте меню командой /help.");
    return;
  }
  if(warehouse&&!hasAny(session.roles,WAREHOUSE_ROLES)){await reply(chatId,"Недостаточно прав для склада");return;}
  if (financial && !hasAny(session.roles, FINANCE_ROLES)) { await reply(chatId, "Недостаточно прав для финансовой операции"); return; }

  try {
    await dispatchCallback(chatId, session, action, rest);
  } catch (e) {
    if (e instanceof CrmError) {
      await reply(chatId, `❌ ${e.message}`);
    } else {
      console.error("[engine] callback:", e);
      await reply(chatId, "❌ Внутренняя ошибка, попробуйте ещё раз");
    }
  }
}

async function dispatchCallback(
  chatId: number,
  session: Session,
  action: string,
  rest: string[],
): Promise<void> {
  if(action==="sw"){
    const dialog=getDialog(chatId);
    await stockMovementCallback({reply,getDialog,setDialog},chatId,session.userId,dialog?.kind==="stockMovement"?dialog:undefined,rest);return;
  }
  if (action === "sp") {
    const dialog = getDialog(chatId);
    await stockPurchaseCallback({ reply, getDialog, setDialog },chatId,session.userId,dialog?.kind === "stockPurchase" ? dialog : undefined,rest); return;
  }
  if (["proj", "stage", "st", "edit"].includes(action) && !hasAny(session.roles, ["ADMIN", "DIRECTOR", "MANAGER"])) {
    await reply(chatId, "Недостаточно прав"); return;
  }
  if (action === "cancel") {
    setDialog(chatId, null);
    await reply(chatId, "Отменено.");
    return;
  }

  // Карточка проекта (в т.ч. «Обновить»)
  if (action === "proj") {
    await showProjectCard(chatId, session, rest[0]);
    return;
  }

  // Смена этапа: запрос списка этапов
  if (action === "stage") {
    const projectId = rest[0];
    const card=await crm.project(session.userId,projectId);
    if(!card.project){await reply(chatId,"Проект не найден");return;}
    const token=randomUUID().slice(0,8);
    stageMenus.set(String(chatId),{projectId,projectNumber:card.project.number,expectedStage:card.project.stage,token,mutations:{}});
    setDialog(chatId, null); // сброс возможного незавершённого диалога
    await reply(
      chatId,
      "Выберите новый статус:",
      buttonsRow(
        STAGE_ORDER.map((stage) => ({
          text: STAGE_LABELS[stage],
          callback_data: `st:${projectId}:${stage}:${token}`,
        })),
        2,
      ),
    );
    return;
  }
  if (action === "st") {
    const [projectId, toStage,token] = rest;
    const menu=stageMenus.get(String(chatId));
    if(!menu||menu.projectId!==projectId||menu.token!==token){await reply(chatId,"Откройте выбор статуса заново: исходный статус отсутствует");return;}
    if (!STAGE_ORDER.includes(toStage)) { await reply(chatId, "Этот статус больше не используется. Откройте выбор статуса заново."); return; }
    const clientMutationId=menu.mutations[toStage]??(menu.mutations[toStage]=randomUUID());
    if (toStage === "REFUSED") {
      setDialog(chatId, {
        kind: "stage",
        projectId,
        projectNumber: menu.projectNumber, expectedStage:menu.expectedStage,clientMutationId,
        step: "refusalReason",
      });
      await reply(chatId, "Причина отказа:");
      return;
    }
    const result = await crm.changeStage(session.userId, projectId, toStage,undefined,menu.expectedStage,clientMutationId);
    await reply(
      chatId,
      result.ok
        ? `✅ Статус: ${STAGE_LABELS[toStage] ?? toStage}`
        : `❌ ${result.error}`,
    );
    return;
  }

  // Реквизиты: выбор поля
  if (action === "edit") {
    const projectId = rest[0];
    await reply(
      chatId,
      "Что изменить:",
      buttonsRow(
        [
          { text: "Название", callback_data: `ed:${projectId}:title` },
          { text: "Адрес", callback_data: `ed:${projectId}:address` },
          { text: "Менеджер", callback_data: `ed:${projectId}:manager` },
        ],
        2,
      ),
    );
    return;
  }
  if (action === "ed") {
    const [projectId, field] = rest as [string, "title" | "address" | "manager"];
    if (!["title", "address", "manager"].includes(field)) { await reply(chatId, "Это поле недоступно для редактирования."); return; }
    const card = await crm.project(session.userId, projectId);
    if(!card.project?.fullBaseline){await reply(chatId,"Откройте карточку заново: исходные значения отсутствуют");return;}
    const expectedBaseline=card.project.fullBaseline;
    const projectNumber = card.project.number;
    if (field === "manager") {
      const managers = await crm.directory(session.userId, "managers");
      setDialog(chatId, { kind: "edit", projectId, projectNumber, field,expectedBaseline,clientMutationId:randomUUID() });
      await reply(
        chatId,
        "Выберите менеджера:",
        buttonsRow(
          [
            { text: "— без менеджера", callback_data: `mgr:none` },
            ...(managers.items ?? []).map((item) => ({
              text: item.label,
              callback_data: `mgr:${item.id}`,
            })),
          ],
          2,
        ),
      );
      return;
    }
    const prompts: Record<string, string> = {
      title: "Новое название:",
      address: "Новый адрес («—» — очистить):",
    };
    if (field === "address" && !card.project) { await reply(chatId, "Проект не найден."); return; }
    setDialog(chatId, { kind: "edit", projectId, projectNumber, field,expectedBaseline,clientMutationId:randomUUID(), ...(field === "address" ? { expectedAddress: card.project!.address } : {}) });
    await reply(chatId, `П-${projectNumber}. ${prompts[field]}`, [[CANCEL_BUTTON]]);
    return;
  }
  if (action === "mgr") {
    const dialog = getDialog(chatId);
    const value = rest[0];
    if (dialog?.kind === "edit") {
      if(!dialog.expectedBaseline){await reply(chatId,"Откройте редактирование заново: исходные значения отсутствуют");return;}
      const result = await saveProjectEdit(session,dialog,"managerId",value === "none" ? null : value);
      if(result.ok)setDialog(chatId, null);
      await reply(chatId, result.ok ? `✅ Менеджер сохранён` : `❌ ${result.error}`);
      return;
    }
    if (dialog?.kind === "newProject") {
      dialog.managerId = value === "none" ? null : value;
      setDialog(chatId, null);
      const input: Record<string, unknown> = { title: dialog.title, clientId: dialog.clientId };
      if (dialog.managerId) input.managerId = dialog.managerId;
      const result = await crm.createProject(session.userId, input);
      await reply(chatId, result.ok
        ? `✅ Проект П-${result.number} «${dialog.title}» создан.\nВалюта: BYN`
        : `❌ ${result.error ?? "Не удалось создать проект"}`);
    }
    return;
  }

  // Создание проекта
  if (action === "cli") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "newProject") {
      await reply(chatId, "Сессия устарела — начните заново: /новый");
      return;
    }
    dialog.clientId = rest[0];
    dialog.step = "manager";
    setDialog(chatId, dialog);
    const managers = await crm.directory(session.userId, "managers");
    await reply(
      chatId,
      "3/3 Менеджер проекта:",
      buttonsRow(
        [
          { text: "— без менеджера", callback_data: `mgr:none` },
          ...(managers.items ?? []).map((item) => ({
            text: item.label,
            callback_data: `mgr:${item.id}`,
          })),
        ],
        2,
      ),
    );
    return;
  }

  // Callback из старого мастера не может задать валюту нового проекта.
  if (action === "npc") {
    setDialog(chatId, null);
    await reply(chatId, "Новые проекты создаются только в BYN. Сессия устарела — начните заново: /новый");
    return;
  }

  // Платёж
  if (action === "payin" || action === "payout") {
    if (await blockPendingFinance(chatId, session)) return;
    const result = await crm.paymentProject(session.userId, rest[0] ?? "");
    const project = result.projects?.[0];
    if (!result.ok || !project) {
      await reply(chatId, result.error ?? "Проект не найден");
      return;
    }
    const expense = action === "payout";
    await selectPaymentProject(chatId, session, {
      kind: "payment", direction: expense ? "EXPENSE" : "INCOME", step: "project", clientMutationId: randomUUID(),
      projectSelected: false, ...(expense ? { reportDocuments: [] } : {}),
    }, project);
    return;
  }
  if (action === "paygeneral") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "project" || rest[0] !== dialog.clientMutationId) {
      await reply(chatId, "Сессия устарела — начните оформление заново"); return;
    }
    dialog.projectSelected = true; dialog.projectId = null; dialog.projectNumber = undefined; dialog.projectCurrency = "BYN";
    await nextPaymentStep(chatId, session, dialog, false); return;
  }
  if (action === "paylist") {
    const menu = financeProjectMenus.get(chatId);
    const project = dialogChoice(menu?.token, menu?.projects, rest[0], rest[1]);
    if (!project) { await reply(chatId, "Обновите список командой /проекты"); return; }
    if (rest[2] !== "income" && rest[2] !== "expense") {
      await reply(chatId, `П-${project.number} ${project.title}`, [[
        { text: "Приход", callback_data: `paylist:${rest[0]}:${rest[1]}:income` },
        { text: "Расход", callback_data: `paylist:${rest[0]}:${rest[1]}:expense` },
      ]]);
      return;
    }
    if (await blockPendingFinance(chatId, session)) return;
    const expense = rest[2] === "expense";
    financeProjectMenus.delete(chatId);
    await selectPaymentProject(chatId, session, {
      kind: "payment", direction: expense ? "EXPENSE" : "INCOME", step: "project", clientMutationId: randomUUID(),
      projectSelected: false, ...(expense ? { reportDocuments: [] } : {}),
    }, project);
    return;
  }
  if (action === "payproj") {
    const dialog = getDialog(chatId);
    const project = dialog?.kind === "payment" && dialog.step === "project" && rest[0] === dialog.clientMutationId
      ? dialogChoice(dialog.choiceToken, dialog.choices, rest[2], rest[3]) : undefined;
    if (dialog?.kind !== "payment" || !project) { await reply(chatId, "Выбор устарел. Уточните проект."); return; }
    await selectPaymentProject(chatId, session, dialog, project);
    return;
  }
  if (action === "payoptions") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "confirm" || dialog.busy || rest[0] !== dialog.clientMutationId) return;
    if (rest[1] === "date") {
      dialog.step = "paidAt";
      await reply(chatId, "Введите дату оплаты ГГГГ-ММ-ДД или «авто» для текущей даты.", [[CANCEL_BUTTON]]);
    } else if (rest[1] === "rate" && dialog.currency !== "BYN") {
      dialog.step = "rate";
      await reply(chatId, `Введите курс BYN за 1 ${dialog.currency} или «авто» для НБ РБ.`, [[CANCEL_BUTTON]]);
    }
    return;
  }
  if (action === "cur") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "currency" || !dialog.amount || !CURRENCIES.includes(rest[0])) {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    dialog.currency = rest[0];
    dialog.step = "cash";
    setDialog(chatId, dialog);
    const accounts = (await crm.directory(session.userId, "cash")).items ?? [];
    const inCurrency = accounts.filter((item) => item.currency === rest[0]);
    if (inCurrency.length === 0) {
      await reply(chatId, `Нет активной кассы в ${rest[0]} — выберите другую валюту.`);
      await nextPaymentStep(chatId, session, dialog, true);
      return;
    }
    await reply(
      chatId,
      `Касса (${rest[0]}):`,
      buttonsRow(
        inCurrency.map((item) => ({
          text: item.label,
          callback_data: `cash:${item.id}`,
        })),
        2,
      ),
    );
    return;
  }
  if (action === "cash") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "cash") {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    const accounts = (await crm.directory(session.userId, "cash")).items ?? [];
    const account = accounts.find((item) => item.id === rest[0]);
    if (!account || account.currency !== dialog.currency) { await reply(chatId, "Выберите действующую кассу в валюте операции"); return; }
    dialog.cashAccountId = rest[0];
    dialog.cashLabel = account?.label ?? rest[0];
    if (dialog.direction === "EXPENSE") {
      dialog.step = "article";
      setDialog(chatId, dialog);
      const articles = (await crm.directory(session.userId, "articles")).items ?? [];
      if (articles.length === 0) {
        await reply(chatId, "Нет активных статей расхода — создайте их в CRM.");
        return;
      }
      await reply(
        chatId,
        "Статья расхода:",
        buttonsRow(
          articles.map((item) => ({ text: item.label, callback_data: `art:${item.id}` })),
          2,
        ),
      );
      return;
    }
    dialog.step = "comment";
    setDialog(chatId, dialog);
    await reply(chatId, "Комментарий («—» — без комментария):", [[CANCEL_BUTTON]]);
    return;
  }
  if (action === "art") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "article") {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    const articles = (await crm.directory(session.userId, "articles")).items ?? [];
    if (!articles.some(item => item.id === rest[0])) { await reply(chatId, "Выберите действующую статью расхода"); return; }
    dialog.articleId = rest[0];
    dialog.articleLabel = articles.find((item) => item.id === rest[0])?.label ?? rest[0];
    dialog.step = "comment";
    setDialog(chatId, dialog);
    await reply(chatId, "Комментарий («—» — без комментария):", [[CANCEL_BUTTON]]);
    return;
  }
  if (action === "nocomment") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "comment") {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    dialog.comment = undefined;
    await confirmPayment(chatId, session, dialog);
    return;
  }
  if (action === "payok") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "confirm" || rest[0] !== dialog.clientMutationId ||
        !dialog.projectSelected || !dialog.amount || !dialog.currency || !dialog.cashAccountId ||
        (dialog.direction === "EXPENSE" && (!paymentDocuments(dialog).length || hasUnresolvedDocumentAttempt(dialog)))) {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    if (dialog.busy) return;
    dialog.busy = true;
    try {
    const result = await submitFinanceCommand(chatId, { kind: "payment", actorId: session.userId, input: {
      clientMutationId: dialog.clientMutationId,
      projectId: dialog.projectId ?? null,
      direction: dialog.direction,
      amount: dialog.amount,
      currency: dialog.currency,
      ...(dialog.paidAt ? { paidAt: dialog.paidAt } : {}),
      ...(dialog.rate ? { rate: dialog.rate } : {}),
      cashAccountId: dialog.cashAccountId,
      ...(dialog.direction === "EXPENSE" ? { expenseArticleId: dialog.articleId } : {}),
      ...paymentReportDocumentInput(dialog),
      ...(dialog.comment ? { comment: dialog.comment } : {}),
    } });
    if (result.ok && getDialog(chatId) === dialog) setDialog(chatId, null);
    const label = dialog.direction === "INCOME" ? "Приход" : "Расход";
    await reply(
      chatId,
      result.ok
        ? `✅ ${label} ${formatMoney(dialog.amount, dialog.currency)} · ${paymentContext(dialog)} — записано`
        : `❌ ${result.error}. Данные сохранены — повторите подтверждение или отмените операцию.`,
    );
    } catch (error) {
      await reply(chatId, error instanceof CrmError ? `❌ ${error.message}. Повторите подтверждение: идентификатор операции сохранён.` : "Не удалось подтвердить операцию. Повторите подтверждение.");
    } finally { dialog.busy = false; }
    return;
  }
  if (action === "doccontinue") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "document" || dialog.busy ||
        rest[0] !== dialog.clientMutationId || dialog.documentAttempt || !paymentDocuments(dialog).length) return;
    await confirmPayment(chatId, session, dialog); return;
  }
  if (action === "docexclude") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || dialog.step !== "document" || dialog.busy ||
        rest[0] !== dialog.documentAttempt?.clientMutationId) return;
    dialog.documentAttempt = undefined; await paymentDocumentList(chatId, dialog); return;
  }
  if (action === "docretry") {
    const dialog = getDialog(chatId), current = await getSession(String(chatId));
    if (!current || !hasAny(current.roles, FINANCE_ROLES) ||
        dialog?.kind !== "payment" || dialog.step !== "document" || rest[0] !== dialog.documentAttempt?.clientMutationId) {
      await reply(chatId, "Загрузка недоступна — начните оформление расхода заново"); return;
    }
    await uploadPaymentDocument(chatId, current, dialog);
  }
}
