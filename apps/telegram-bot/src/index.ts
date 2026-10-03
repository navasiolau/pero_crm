import {resolveBotCalendarContext,sendCalendarTelegramMessage} from "./calendar-reminders";
import {createCalendarReminderJob} from "./calendar-job";
import { config } from "./config";
import { crm } from "./crm";
import { tg, TgError } from "./tg";
import { handleUpdate } from "./engine";
import { BotHealthReporter } from "./health";

// Точка входа: long polling Telegram + обработка обновлений.
// Только исходящие соединения (Telegram API + CRM) — входящих портов нет.

const POLL_TIMEOUT_SEC = 25;
const CRM_HEALTH_INTERVAL_MS = config.recoveryTest ? 100 : 30_000;
const health = new BotHealthReporter(config.healthFile);
let calendarJob:ReturnType<typeof createCalendarReminderJob>|null=null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerWithRetry(username: string): Promise<void> {
  for (;;) {
    try {
      await crm.register(username);
      console.log(`[bot] зарегистрирован в CRM (@${username})`);
      return;
    } catch (e) {
      console.error(`[bot] CRM недоступна: ${(e as Error).message}; повтор через 10 с`);
      await sleep(10000);
    }
  }
}

async function monitorCrmHealth(): Promise<never> {
  for (;;) {
    try {
      await crm.health();
      health.crmSuccess();
      void calendarJob?.tick();
    } catch {
      health.crmFailure();
    }
    await sleep(CRM_HEALTH_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  void monitorCrmHealth();
  const me = await tg.getMe();
  if (!me.username) {
    console.error("[bot] у бота нет username — проверьте токен");
    process.exit(1);
  }
  try {
    const context=resolveBotCalendarContext(process.env,String(me.id),config.crmBaseUrl);
    calendarJob=createCalendarReminderJob(context,{claim:crm.calendarClaim,authorize:crm.calendarAuthorize,ack:crm.calendarAck,send:claim=>sendCalendarTelegramMessage({apiOrigin:config.telegramApiOrigin,token:config.token,claim})});
  } catch {console.error('[bot] calendar reminders disabled: invalid context');}
  console.log(`[bot] запущен как @${me.username}`);
  await registerWithRetry(me.username);

  // Перерегистрация каждые 6 ч: ночной refresh staging пересоздаёт БД
  // (OrgSetting стирается) — botUsername должен восстанавливаться без
  // рестарта контейнера.
  void (async () => {
    for (;;) {
      await sleep(6 * 3600 * 1000);
      try {
        await crm.register(me.username!);
        console.log("[bot] перерегистрирован в CRM");
      } catch (e) {
        console.error("[bot] перерегистрация:", (e as Error).message);
      }
    }
  })();

  let offset = 0;
  let consecutiveErrors = 0;
  for (;;) {
    try {
      const updates = await tg.getUpdates(offset, POLL_TIMEOUT_SEC);
      health.pollingSuccess();
      consecutiveErrors = 0;
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (e) {
          console.error("[bot] ошибка обработки обновления:", e);
          const chatId =
            update.message?.chat.id ?? update.callback_query?.message.chat.id;
          if (chatId) {
            try {
              await tg.sendMessage(chatId, "❌ Ошибка, попробуйте ещё раз");
            } catch {
              // не смогли и ответить — пишем только в лог
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof TgError && e.code === 409) {
        health.pollingFailure("telegram-conflict");
        console.error("[bot] 409 Conflict — другой экземпляр уже опрашивает этот токен");
        await sleep(30000);
        continue;
      }
      consecutiveErrors++;
      health.pollingFailure("telegram-poll-failed");
      const delay = Math.min(30000, 2000 * consecutiveErrors);
      console.error(
        `[bot] ошибка polling (${consecutiveErrors}): ${(e as Error).message} — пауза ${delay} мс`,
      );
      await sleep(delay);
    }
  }
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

void config; // конфиг валидируется при импорте (exit при отсутствии переменных)
main().catch((e) => {
  console.error("[bot] фатальная ошибка:", e);
  process.exit(1);
});
