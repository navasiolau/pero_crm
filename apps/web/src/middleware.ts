// Next 15.5 поддерживает Node middleware: Prisma здесь проверяет отзыв JWT
// до ролевого ограничения маршрута, как и во всех серверных вызовах auth().
export { auth as default } from "@/auth";

export const config = {
  runtime: "nodejs",
  // Upload проверяет текущую auth/session и upload grants в route до чтения тела.
  // Next 15.5 Node middleware асинхронно восстанавливает клонированное POST body;
  // исключение точного endpoint предотвращает pre-handler disturbed-stream race.
  matcher: [
    "/((?!login|api/auth|api/health$|api/files/upload$|api/finance/documents/upload$|api/v1|manifest\\.webmanifest|sw\\.js|swe-worker|icon\\.svg|apple-icon\\.png|icons|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
