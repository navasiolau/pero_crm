import Script from "next/script";
import { TelegramFinanceEntry } from "./telegram-finance-entry";

export default function TelegramFinancePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-5">
      <TelegramFinanceEntry />
      <Script src="https://telegram.org/js/telegram-web-app.js?65" strategy="afterInteractive" />
    </main>
  );
}
