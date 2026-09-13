import { config } from "./config";
import { crm } from "./crm";
import { tg, TgError } from "./tg";
import { handleUpdate } from "./engine";

// Точка входа: long polling Telegram + обработка обновлений.
// Только исходящие соединения (Telegram API + CRM) — входящих портов нет.

const POLL_TIMEOUT_SEC = 25;

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

async function main(): Promise<void> {
  const me = await tg.getMe();
  if (!me.username) {
    console.error("[bot] у бота нет username — проверьте токен");
    process.exit(1);
  }
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
        console.error("[bot] 409 Conflict — другой экземпляр уже опрашивает этот токен");
        await sleep(30000);
        continue;
      }
      consecutiveErrors++;
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
