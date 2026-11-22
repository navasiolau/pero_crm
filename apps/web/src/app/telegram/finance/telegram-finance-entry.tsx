"use client";

import { useEffect, useState } from "react";

type TelegramWindow = Window & { Telegram?: { WebApp?: { initData?: string; ready(): void; expand(): void } } };

export function TelegramFinanceEntry() {
  const [status, setStatus] = useState("Подключаем финансы…");
  useEffect(() => {
    const controller = new AbortController();
    const deadline = Date.now() + 5000;
    let timer: ReturnType<typeof setTimeout>;
    async function connect() {
      const app = (window as TelegramWindow).Telegram?.WebApp;
      if (!app?.initData) {
        if (Date.now() < deadline) timer = setTimeout(connect, 120);
        else {
          setStatus("Откройте «Финансы» в личном чате с ботом PERO.");
        }
        return;
      }
      app.ready();
      app.expand();
      try {
        const response = await fetch("/api/telegram/finance/session", {
          method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: app.initData, signal: controller.signal,
        });
        const data = await response.json();
        if (response.ok && data.ok) return window.location.replace("/finance");
        setStatus(data.error || "Не удалось открыть финансы. Повторите вход в Telegram.");
      } catch {
        if (!controller.signal.aborted) {
          setStatus("CRM временно недоступна. Откройте финансы заново.");
        }
      }
    }
    void connect();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  return (
    <div className="w-full space-y-4">
      <h1 className="text-2xl font-semibold">Финансы PERO</h1>
      <p className="text-sm text-muted-foreground" aria-live="polite">{status}</p>
    </div>
  );
}
