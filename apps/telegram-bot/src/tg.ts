import { config } from "./config";

// Минимальный клиент Telegram Bot API (long polling) — без зависимостей.

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TgError extends Error {
  readonly code?: number;
  constructor(method: string, description: string, code?: number) {
    super(`Telegram ${method}: ${description}`);
    this.code = code;
  }
}

async function call<T>(
  method: string,
  payload?: Record<string, unknown>,
  timeoutMs = 35000,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.telegramApiOrigin}/bot${config.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new TgError(method, `сеть недоступна: ${(e as Error).message}`);
  }
  const data = (await response.json().catch(() => null)) as TgResponse<T> | null;
  if (!data || !data.ok || data.result === undefined) {
    throw new TgError(
      method,
      data?.description ?? `HTTP ${response.status}`,
      data?.error_code,
    );
  }
  return data.result;
}

export const tg = {
  getMe(): Promise<TgUser> {
    return call<TgUser>("getMe", {}, 10000);
  },
  getUpdates(offset: number, timeoutSec: number): Promise<TgUpdate[]> {
    return call<TgUpdate[]>(
      "getUpdates",
      {
        offset,
        timeout: timeoutSec,
        allowed_updates: ["message", "callback_query"],
      },
      timeoutSec * 1000 + 15000,
    );
  },
  sendMessage(
    chatId: number | string,
    text: string,
    buttons?: InlineButton[][],
  ): Promise<TgMessage> {
    return call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...(buttons && buttons.length > 0
        ? { reply_markup: { inline_keyboard: buttons } }
        : {}),
    });
  },
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    buttons?: InlineButton[][],
  ): Promise<TgMessage> {
    return call<TgMessage>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(buttons && buttons.length > 0
        ? { reply_markup: { inline_keyboard: buttons } }
        : {}),
    }, 15000);
  },
  answerCallbackQuery(id: string): Promise<void> {
    return call<void>("answerCallbackQuery", { callback_query_id: id }, 10000);
  },
};
