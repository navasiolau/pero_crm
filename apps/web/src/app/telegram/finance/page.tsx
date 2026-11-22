import { TelegramWebAppScript } from "@/components/telegram-web-app-script";
import { TelegramFinanceEntry } from "./telegram-finance-entry";

export default function TelegramFinancePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-5">
      <TelegramFinanceEntry />
      <TelegramWebAppScript />
    </main>
  );
}
