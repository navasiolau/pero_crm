"use client";

import { useLayoutEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Truck, Wallet } from "lucide-react";
import { TelegramFinanceUiScope } from "./telegram-finance-scope";
import { TelegramWebAppScript } from "./telegram-web-app-script";

const areas = [
  { href: "/finance", label: "Финансы", icon: Wallet },
  { href: "/logistics", label: "Логистика", icon: Truck },
] as const;

export function TelegramFinanceWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/finance";
  const rootPage = areas.some(area => pathname === area.href);

  useLayoutEffect(() => {
    // Диалоги и выпадающие меню выводятся в портал вне оболочки.
    const root = document.documentElement;
    root.setAttribute("data-telegram-finance", "");
    return () => root.removeAttribute("data-telegram-finance");
  }, []);

  return (
    <TelegramFinanceUiScope>
      <div data-telegram-finance-workspace data-telegram-root-page={rootPage ? "" : undefined}>
        <main className="telegram-finance-main">{children}</main>
        <nav className="telegram-finance-dock" aria-label="Рабочие разделы">
          <div className="telegram-finance-tabs">
            {areas.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </nav>
      </div>
      <TelegramWebAppScript />
    </TelegramFinanceUiScope>
  );
}
