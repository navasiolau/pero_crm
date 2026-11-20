// Next 15.5 поддерживает Node middleware: Prisma здесь проверяет отзыв JWT
// до ролевого ограничения маршрута, как и во всех серверных вызовах auth().
import { NextResponse, type NextMiddleware } from "next/server";
import { auth } from "@/auth";
import { isTelegramFinancePath, TELEGRAM_FINANCE_COOKIE, TELEGRAM_FINANCE_LAYOUT_HEADER } from "@/server/telegram/finance-security";
import { resolveTelegramFinanceSession, telegramFinanceConfig } from "@/server/telegram/finance-session";

const webMiddleware = auth as unknown as NextMiddleware;

const middleware: NextMiddleware = async (request, event) => {
  const raw = request.cookies.get(TELEGRAM_FINANCE_COOKIE)?.value;
  if (raw && telegramFinanceConfig() && isTelegramFinancePath(request.nextUrl.pathname)) {
    const session = await resolveTelegramFinanceSession(raw);
    if (!session) {
      if (request.method !== "GET" || request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Сессия Telegram завершена." }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/telegram/finance", request.url));
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
    "/((?!login|telegram/finance$|api/telegram/finance/(?:session|binding)$|api/auth|api/health$|api/kp(?:/|$)|api/files/upload$|api/finance/documents/upload$|api/logistics/documents/upload$|api/v1|manifest\\.webmanifest|sw\\.js|swe-worker|icon\\.svg|apple-icon\\.png|icons|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
