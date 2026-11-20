"use client";

import { useEffect, useState, type FormEvent } from "react";

type TelegramWindow = Window & { Telegram?: { WebApp?: { initData?: string; ready(): void; expand(): void } } };

export function TelegramFinanceEntry() {
  const [status, setStatus] = useState("Подключаем финансы…");
  const [step, setStep] = useState<"loading" | "account" | "confirm" | "closed">("loading");
  const [candidate, setCandidate] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const deadline = Date.now() + 5000;
    let timer: ReturnType<typeof setTimeout>;
    async function connect() {
      const app = (window as TelegramWindow).Telegram?.WebApp;
      if (!app?.initData) {
        if (Date.now() < deadline) timer = setTimeout(connect, 120);
        else {
          setStep("closed");
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
        if (response.status === 409 && data.code === "LINK_REQUIRED") {
          setStep(data.candidate ? "confirm" : "account");
          setCandidate(data.candidate ?? "");
          return setStatus("");
        }
        setStep("closed");
        setStatus(data.error || "Не удалось открыть финансы. Повторите вход в Telegram.");
      } catch {
        if (!controller.signal.aborted) {
          setStep("closed");
          setStatus("CRM временно недоступна. Откройте финансы заново.");
        }
      }
    }
    void connect();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (step !== "account" && step !== "confirm")) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = step === "account" ? { step, email: data.get("email"), password: data.get("password") } : { step };
    if (step === "account") {
      const password = form.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
    }
    setPending(true);
    setStatus("");
    try {
      const response = await fetch("/api/telegram/finance/binding", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) return setStatus(result.error || "Подключение не удалось. Откройте финансы заново.");
      if (step === "confirm") return window.location.replace("/finance");
      setCandidate(result.name);
      setStep("confirm");
    } catch {
      setStatus("CRM временно недоступна. Откройте финансы заново.");
    } finally { setPending(false); }
  }

  return (
    <div className="w-full space-y-4">
      <h1 className="text-2xl font-semibold">Финансы PERO</h1>
      {step === "account" ? (
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">Войдите в свою учётную запись CRM, чтобы подключить этот Telegram.</p>
          <label className="block space-y-1 text-sm">
            <span>Электронная почта CRM</span>
            <input className="block w-full rounded-md border px-3 py-2" name="email" type="email" autoComplete="username" maxLength={254} required />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Пароль CRM</span>
            <input className="block w-full rounded-md border px-3 py-2" name="password" type="password" autoComplete="current-password" maxLength={1024} required />
          </label>
          <button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Продолжить</button>
        </form>
      ) : null}
      {step === "confirm" ? (
        <form className="space-y-4" onSubmit={submit}>
          <p>Подключить этот Telegram к учётной записи «{candidate}»?</p>
          <button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Подтвердить привязку</button>
        </form>
      ) : null}
      <p className="text-sm text-muted-foreground" aria-live="polite">{status}</p>
    </div>
  );
}
