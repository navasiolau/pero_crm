import { crm, CrmError, type ProjectRef } from "./crm";
import { tg, TgError, type InlineButton, type TgCallbackQuery, type TgUpdate } from "./tg";
import {
  CURRENCIES,
  FINANCE_ROLES,
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
}

type Dialog =
  | {
      kind: "newProject";
      step: "title" | "client" | "currency" | "manager" | "initialPrice";
      title: string;
      clientId?: string;
      currency: string;
      managerId?: string | null;
    }
  | {
      kind: "payment";
      direction: "INCOME" | "EXPENSE";
      step: "project" | "amount" | "currency" | "cash" | "article" | "comment";
      projectId?: string;
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
      step:
        | "refusalReason"
        | "refusalComment"
        | "reclamationReason"
        | "reclamationDescription"
        | "reclamationFault";
      refusalReason?: string;
      reclamationReason?: string;
      reclamationDescription?: string;
    }
  | {
      kind: "edit";
      projectId: string;
      projectNumber: string;
      field: "title" | "address" | "initialPrice" | "manager";
    };

const dialogs = new Map<string, Dialog>();
const sessionCache = new Map<string, Session & { at: number }>();
const noticeAt = new Map<string, number>();
const SESSION_TTL_MS = 60_000;

function getDialog(chatId: number): Dialog | undefined {
  return dialogs.get(String(chatId));
}
function setDialog(chatId: number, dialog: Dialog | null): void {
  if (dialog) dialogs.set(String(chatId), dialog);
  else dialogs.delete(String(chatId));
}

async function getSession(chatId: string): Promise<Session | null> {
  const cached = sessionCache.get(chatId);
  if (cached && Date.now() - cached.at < SESSION_TTL_MS) return cached;
  const response = await crm.session(chatId);
  if (!response.found || !response.user) return null;
  const session: Session = {
    userId: response.user.id,
    name: response.user.name,
    roles: response.user.roles,
    botAllowed: response.user.botAllowed,
  };
  sessionCache.set(chatId, { ...session, at: Date.now() });
  return session;
}

function dropSession(chatId: string): void {
  sessionCache.delete(chatId);
}

const CANCEL_BUTTON: InlineButton = { text: "❌ Отмена", callback_data: "cancel" };

async function reply(
  chatId: number,
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  try {
    await tg.sendMessage(chatId, text, buttons);
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
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
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
        `${session.name}, бот доступен только менеджерам, администраторам и директорам.`,
      );
    }
    return;
  }

  if (cmd !== "") {
    await handleCommand(chatId, session, cmd, args);
    return;
  }

  const dialog = getDialog(chatId);
  if (dialog) {
    await handleDialogText(chatId, session, dialog, text);
    return;
  }
  await reply(chatId, "Команды бота — /help");
}

function parseCommand(text: string): { cmd: string; args: string[] } {
  const parts = text.split(/\s+/);
  const cmd = parts[0]?.replace(/@[\w_]+$/, "").toLowerCase() ?? "";
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
      `Аккаунт привязан: ${who}.\nБот доступен только менеджерам, администраторам и директорам — команды неактивны.`,
    );
    return;
  }
  await reply(chatId, `✅ Привязано: ${who}\n\nСписок команд — /help`);
}

// ─── Команды ─────────────────────────────────────────────────────────────────

async function handleCommand(
  chatId: number,
  session: Session,
  cmd: string,
  args: string[],
): Promise<void> {
  switch (cmd) {
    case "/start":
    case "/help": {
      await reply(chatId, helpText(session));
      return;
    }
    case "/новый":
    case "/new": {
      setDialog(chatId, {
        kind: "newProject",
        step: "title",
        title: "",
        currency: "BYN",
      });
      await reply(
        chatId,
        "Создание проекта.\n1/5 Название заказа:",
        [[CANCEL_BUTTON]],
      );
      return;
    }
    case "/проекты":
    case "/projects": {
      const result = await crm.projects(session.userId);
      const projects = result.projects ?? [];
      if (projects.length === 0) {
        await reply(chatId, "Проектов не найдено.");
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

function helpText(session: Session): string {
  const lines = [
    "Команды бота:",
    "/новый — создать проект",
    "/проект <номер> — карточка проекта (этап, реквизиты, платежи)",
    "/проекты — последние проекты",
  ];
  if (hasAny(session.roles, FINANCE_ROLES)) {
    lines.push(
      "/приход [номер] [сумма] — приход по проекту",
      "/расход [номер] [сумма] — расход по проекту",
    );
  }
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
      { text: "🔀 Сменить этап", callback_data: `stage:${projectId}` },
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
      await reply(chatId, "2/5 Клиент — введите имя/фамилию или телефон для поиска:", [
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
    case "initialPrice": {
      const value = text === "-" || text === "—" ? null : parseAmount(text);
      if (text !== "-" && text !== "—" && value === null) {
        await reply(chatId, "Сумма не распознана (пример: 12500 или 12500,50), либо «—»:");
        return;
      }
      setDialog(chatId, null);
      const input: Record<string, unknown> = {
        title: dialog.title,
        clientId: dialog.clientId,
        currency: dialog.currency,
      };
      if (dialog.managerId) input.managerId = dialog.managerId;
      if (value !== null) input.initialPrice = value;
      const result = await crm.createProject(session.userId, input);
      if (!result.ok) {
        await reply(chatId, `❌ ${result.error ?? "Не удалось создать проект"}`);
        return;
      }
      await reply(
        chatId,
        `✅ Проект П-${result.number} «${dialog.title}» создан.\nВалюта: ${dialog.currency}\nПервоначальная цена: ${value === null ? "—" : formatMoney(value, dialog.currency)}`,
      );
      return;
    }
    default:
      setDialog(chatId, null);
  }
}

// — Платёж (приход/расход) —

async function startPayment(
  chatId: number,
  session: Session,
  direction: "INCOME" | "EXPENSE",
  args: string[],
): Promise<void> {
  if (!hasAny(session.roles, FINANCE_ROLES)) {
    await reply(
      chatId,
      "Платежи доступны администратору, директору и бухгалтеру.",
    );
    return;
  }
  const dialog: Extract<Dialog, { kind: "payment" }> = {
    kind: "payment",
    direction,
    step: "project",
  };
  const label = direction === "INCOME" ? "Приход" : "Расход";
  // /расход 205 4000 — номер и сумму можно указать сразу
  if (args[0]) {
    const project = await findProject(session.userId, args[0]);
    if (!project) {
      await reply(chatId, `Проект «${args[0]}» не найден.`);
      return;
    }
    dialog.projectId = project.id;
    dialog.projectNumber = project.number;
    dialog.projectCurrency = project.currency;
  }
  if (args[1] && dialog.projectId) {
    const amount = parseAmount(args[1]);
    if (amount === null) {
      await reply(chatId, "Сумма не распознана (пример: 4000 или 4000,50)");
      return;
    }
    dialog.amount = amount;
  }
  if (dialog.projectId && dialog.amount) {
    await nextPaymentStep(chatId, session, dialog, true);
    return;
  }
  if (dialog.projectId) {
    dialog.step = "amount";
    setDialog(chatId, dialog);
    await reply(chatId, `${label} · П-${dialog.projectNumber}. Сумма:`, [
      [CANCEL_BUTTON],
    ]);
    return;
  }
  setDialog(chatId, dialog);
  await reply(chatId, `${label}. 1 — укажите проект (номер или название):`, [
    [CANCEL_BUTTON],
  ]);
}

async function paymentText(
  chatId: number,
  session: Session,
  dialog: Extract<Dialog, { kind: "payment" }>,
  text: string,
): Promise<void> {
  if (dialog.step === "project") {
    const found = await findProject(session.userId, text);
    if (!found) {
      await reply(chatId, "Не найдено — уточните номер или название:");
      return;
    }
    dialog.projectId = found.id;
    dialog.projectNumber = found.number;
    dialog.projectCurrency = found.currency;
    await nextPaymentStep(chatId, session, dialog, false);
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
  }
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
    await reply(chatId, `${label} · П-${dialog.projectNumber}. Сумма:`, [
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
    `${label} · П-${dialog.projectNumber} · ${formatMoney(dialog.amount, currency)}\nВалюта операции:`,
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
  const label = dialog.direction === "INCOME" ? "Приход" : "Расход";
  const lines = [
    `❗ Подтвердите: ${label}`,
    `Проект: П-${dialog.projectNumber}`,
    `Сумма: ${formatMoney(dialog.amount ?? 0, dialog.currency ?? "BYN")}`,
    `Касса: ${dialog.cashLabel ?? "—"}`,
  ];
  if (dialog.direction === "EXPENSE") {
    lines.push(`Статья: ${dialog.articleLabel ?? "—"}`);
  }
  lines.push(`Комментарий: ${dialog.comment ?? "—"}`);
  setDialog(chatId, dialog);
  await reply(chatId, lines.join("\n"), [
    [
      { text: "✅ Создать", callback_data: "payok" },
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
      dialog.refusalReason = text;
      dialog.step = "refusalComment";
      setDialog(chatId, dialog);
      await reply(chatId, "Комментарий к отказу:");
      return;
    case "refusalComment": {
      const result = await crm.changeStage(session.userId, dialog.projectId, "REFUSED", {
        refusalReason: dialog.refusalReason ?? "",
        refusalComment: text,
      });
      setDialog(chatId, null);
      await reply(
        chatId,
        result.ok
          ? `✅ Этап: ${STAGE_LABELS.REFUSED} · П-${dialog.projectNumber}`
          : `❌ ${result.error}`,
      );
      return;
    }
    case "reclamationReason":
      dialog.reclamationReason = text;
      dialog.step = "reclamationDescription";
      setDialog(chatId, dialog);
      await reply(chatId, "Описание рекламации:");
      return;
    case "reclamationDescription":
      dialog.reclamationDescription = text;
      dialog.step = "reclamationFault";
      setDialog(chatId, dialog);
      await reply(chatId, "Виновная сторона:");
      return;
    case "reclamationFault": {
      const result = await crm.changeStage(
        session.userId,
        dialog.projectId,
        "RECLAMATION",
        {
          reclamationReason: dialog.reclamationReason ?? "",
          reclamationDescription: dialog.reclamationDescription ?? "",
          reclamationFault: text,
        },
      );
      setDialog(chatId, null);
      await reply(
        chatId,
        result.ok
          ? `✅ Этап: ${STAGE_LABELS.RECLAMATION} · П-${dialog.projectNumber}`
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
  let input: Record<string, unknown>;
  switch (dialog.field) {
    case "title":
      input = { title: text };
      break;
    case "address":
      input = { address: text === "-" || text === "—" ? null : text };
      break;
    case "initialPrice": {
      const value = text === "-" || text === "—" ? null : parseAmount(text);
      if (text !== "-" && text !== "—" && value === null) {
        await reply(chatId, "Сумма не распознана (пример: 12500 или 12500,50), либо «—»:");
        return;
      }
      input = { initialPrice: value };
      break;
    }
    default:
      setDialog(chatId, null);
      return;
  }
  const result = await crm.updateProject(session.userId, dialog.projectId, input);
  setDialog(chatId, null);
  await reply(
    chatId,
    result.ok
      ? `✅ Сохранено · П-${dialog.projectNumber}`
      : `❌ ${result.error ?? "Не удалось сохранить"}`,
  );
}

// ─── Кнопки (callback queries) ───────────────────────────────────────────────

async function handleCallback(query: TgCallbackQuery): Promise<void> {
  const chatId = query.message.chat.id;
  try {
    await tg.answerCallbackQuery(query.id);
  } catch {
    // не критично
  }
  const data = query.data ?? "";
  const [action, ...rest] = data.split(":");

  const session = await getSession(String(chatId));
  if (!session) return;
  if (!session.botAllowed) return;

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
    setDialog(chatId, null); // сброс возможного незавершённого диалога
    await reply(
      chatId,
      "Выберите новый этап:",
      buttonsRow(
        STAGE_ORDER.map((stage) => ({
          text: STAGE_LABELS[stage],
          callback_data: `st:${projectId}:${stage}`,
        })),
        2,
      ),
    );
    return;
  }
  if (action === "st") {
    const [projectId, toStage] = rest;
    if (toStage === "REFUSED") {
      const card = await crm.project(session.userId, projectId);
      setDialog(chatId, {
        kind: "stage",
        projectId,
        projectNumber: card.project?.number ?? "",
        step: "refusalReason",
      });
      await reply(chatId, "Причина отказа:");
      return;
    }
    if (toStage === "RECLAMATION") {
      const card = await crm.project(session.userId, projectId);
      setDialog(chatId, {
        kind: "stage",
        projectId,
        projectNumber: card.project?.number ?? "",
        step: "reclamationReason",
      });
      await reply(chatId, "Причина рекламации:");
      return;
    }
    const result = await crm.changeStage(session.userId, projectId, toStage);
    await reply(
      chatId,
      result.ok
        ? `✅ Этап: ${STAGE_LABELS[toStage] ?? toStage}`
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
          { text: "Первоначальная цена", callback_data: `ed:${projectId}:initialPrice` },
          { text: "Менеджер", callback_data: `ed:${projectId}:manager` },
        ],
        2,
      ),
    );
    return;
  }
  if (action === "ed") {
    const [projectId, field] = rest as [string, "title" | "address" | "initialPrice" | "manager"];
    const card = await crm.project(session.userId, projectId);
    const projectNumber = card.project?.number ?? "";
    if (field === "manager") {
      const managers = await crm.directory(session.userId, "managers");
      setDialog(chatId, { kind: "edit", projectId, projectNumber, field });
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
      initialPrice: "Новая первоначальная цена («—» — очистить):",
    };
    setDialog(chatId, { kind: "edit", projectId, projectNumber, field });
    await reply(chatId, `П-${projectNumber}. ${prompts[field]}`, [[CANCEL_BUTTON]]);
    return;
  }
  if (action === "mgr") {
    const dialog = getDialog(chatId);
    const value = rest[0];
    if (dialog?.kind === "edit") {
      const result = await crm.updateProject(session.userId, dialog.projectId, {
        managerId: value === "none" ? null : value,
      });
      setDialog(chatId, null);
      await reply(chatId, result.ok ? `✅ Менеджер сохранён` : `❌ ${result.error}`);
      return;
    }
    if (dialog?.kind === "newProject") {
      dialog.managerId = value === "none" ? null : value;
      dialog.step = "initialPrice";
      setDialog(chatId, dialog);
      await reply(chatId, "5/5 Первоначальная цена — цена КП клиенту (или «—»):");
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
    // Подпись клиента подтянем из справочника по id
    dialog.step = "currency";
    setDialog(chatId, dialog);
    await reply(chatId, "3/5 Валюта проекта:", [
      [
        { text: "✅ BYN", callback_data: `npc:BYN` },
        ...CURRENCIES.filter((c) => c !== "BYN").map(
          (c) => ({ text: c, callback_data: `npc:${c}` }) as InlineButton,
        ),
      ],
      [CANCEL_BUTTON],
    ]);
    return;
  }
  if (action === "npc") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "newProject") {
      await reply(chatId, "Сессия устарела — начните заново: /новый");
      return;
    }
    dialog.currency = rest[0];
    dialog.step = "manager";
    setDialog(chatId, dialog);
    const managers = await crm.directory(session.userId, "managers");
    await reply(
      chatId,
      "4/5 Менеджер проекта:",
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

  // Платёж
  if (action === "payin" || action === "payout") {
    const projectId = rest[0];
    const card = await crm.project(session.userId, projectId);
    if (!card.ok || !card.project) {
      await reply(chatId, card.error ?? "Проект не найден");
      return;
    }
    const dialog: Extract<Dialog, { kind: "payment" }> = {
      kind: "payment",
      direction: action === "payin" ? "INCOME" : "EXPENSE",
      step: "amount",
      projectId: card.project.id,
      projectNumber: card.project.number,
      projectCurrency: card.project.currency,
    };
    setDialog(chatId, dialog);
    await reply(chatId, `${action === "payin" ? "Приход" : "Расход"} · П-${card.project.number}. Сумма:`, [
      [CANCEL_BUTTON],
    ]);
    return;
  }
  if (action === "payproj") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment") {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    const project = await crm.project(session.userId, rest[0]);
    if (!project.ok || !project.project) {
      await reply(chatId, project.error ?? "Проект не найден");
      return;
    }
    dialog.projectId = project.project.id;
    dialog.projectNumber = project.project.number;
    dialog.projectCurrency = project.project.currency;
    await nextPaymentStep(chatId, session, dialog, false);
    return;
  }
  if (action === "cur") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || !dialog.amount) {
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
    if (dialog?.kind !== "payment") {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    const accounts = (await crm.directory(session.userId, "cash")).items ?? [];
    const account = accounts.find((item) => item.id === rest[0]);
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
    if (dialog?.kind !== "payment") {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    const articles = (await crm.directory(session.userId, "articles")).items ?? [];
    dialog.articleId = rest[0];
    dialog.articleLabel = articles.find((item) => item.id === rest[0])?.label ?? rest[0];
    dialog.step = "comment";
    setDialog(chatId, dialog);
    await reply(chatId, "Комментарий («—» — без комментария):", [[CANCEL_BUTTON]]);
    return;
  }
  if (action === "nocomment") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment") {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    dialog.comment = undefined;
    await confirmPayment(chatId, session, dialog);
    return;
  }
  if (action === "payok") {
    const dialog = getDialog(chatId);
    if (dialog?.kind !== "payment" || !dialog.projectId || !dialog.amount || !dialog.currency || !dialog.cashAccountId) {
      await reply(chatId, "Сессия устарела — начните заново");
      return;
    }
    const result = await crm.createPayment(session.userId, {
      projectId: dialog.projectId,
      direction: dialog.direction,
      amount: dialog.amount,
      currency: dialog.currency,
      cashAccountId: dialog.cashAccountId,
      ...(dialog.direction === "EXPENSE" ? { expenseArticleId: dialog.articleId } : {}),
      ...(dialog.comment ? { comment: dialog.comment } : {}),
    });
    setDialog(chatId, null);
    const label = dialog.direction === "INCOME" ? "Приход" : "Расход";
    await reply(
      chatId,
      result.ok
        ? `✅ ${label} ${formatMoney(dialog.amount, dialog.currency)} · П-${dialog.projectNumber} — записано`
        : `❌ ${result.error}`,
    );
    return;
  }
}
