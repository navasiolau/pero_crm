// Next 15.5 поддерживает Node middleware: Prisma здесь проверяет отзыв JWT
// до ролевого ограничения маршрута, как и во всех серверных вызовах auth().
import { NextResponse, type NextMiddleware } from "next/server";
import { auth } from "@/auth";
import { PAYROLL_MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { TELEGRAM_SECTION_DENIED } from "@/server/telegram/access";
import { isTelegramFinancePath, TELEGRAM_FINANCE_COOKIE, TELEGRAM_FINANCE_LAYOUT_HEADER, TELEGRAM_FINANCE_ONLY_HEADER } from "@/server/telegram/finance-security";
import { resolveTelegramFinanceSession, telegramFinanceConfig } from "@/server/telegram/finance-session";

const webMiddleware = auth as unknown as NextMiddleware;
const denied = () => new NextResponse(TELEGRAM_SECTION_DENIED, {
  status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
});

const middleware: NextMiddleware = async (request, event) => {
  const path = request.nextUrl.pathname;
  const telegramOnly = request.headers.get(TELEGRAM_FINANCE_ONLY_HEADER) === "1";
  const inWorkspace = isTelegramFinancePath(path);
  if (telegramOnly && !inWorkspace) return denied();
  const raw = request.cookies.get(TELEGRAM_FINANCE_COOKIE)?.value;
  const financeConfig = telegramFinanceConfig();
  if (telegramOnly || (raw && financeConfig && inWorkspace)) {
    const result = await resolveTelegramFinanceSession(raw);
    if (result?.kind === "forbidden") return denied();
    if (!result) {
      if (!financeConfig || request.method !== "GET" || path.startsWith("/api/")) {
        return NextResponse.json({ error: "Сессия Telegram завершена. Откройте «Финансы» заново." }, {
          status: 401, headers: { "Cache-Control": "private, no-store" },
        });
      }
      return NextResponse.redirect(new URL("/telegram/finance", telegramOnly ? financeConfig.origin : request.url));
    }
    if ((path === "/finance/payroll" || path === "/finance/payroll/export") && !hasAnyRole(result.session.user.roles, PAYROLL_MANAGE_ROLES)) {
      return denied();
    }
    const headers = new Headers(request.headers);
    headers.set(TELEGRAM_FINANCE_LAYOUT_HEADER, "active");
    return NextResponse.next({ request: { headers }, headers: { "Cache-Control": "private, no-store" } });
  }
  return webMiddleware(request, event);
};

export default middleware;

export const config = {
  runtime: "nodejs",
  // Upload проверяет текущую auth/session и upload grants в route до чтения тела.
  // Next 15.5 Node middleware асинхронно восстанавливает клонированное POST body;
  // исключение точного endpoint предотвращает pre-handler disturbed-stream race.
  matcher: [
    "/((?!login|telegram/finance$|api/telegram/finance/session$|api/auth|api/health$|api/kp(?:/|$)|api/files/upload$|api/finance/documents/upload$|api/logistics/documents/upload$|api/v1|manifest\\.webmanifest|sw\\.js|swe-worker|icon\\.svg|apple-icon\\.png|icons|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
