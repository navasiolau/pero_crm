// Next 15.5 поддерживает Node middleware: Prisma здесь проверяет отзыв JWT
// до ролевого ограничения маршрута, как и во всех серверных вызовах auth().
export { auth as default } from "@/auth";

export const config = {
  runtime: "nodejs",
  // Защищаем всё, кроме страницы входа, Auth.js API, PWA-служебных файлов и статики
  matcher: [
    "/((?!login|api/auth|api/health$|api/v1|manifest\\.webmanifest|sw\\.js|swe-worker|icon\\.svg|apple-icon\\.png|icons|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
