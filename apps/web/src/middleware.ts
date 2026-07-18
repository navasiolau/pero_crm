import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Защищаем всё, кроме страницы входа, Auth.js API, PWA-служебных файлов и статики
  matcher: [
    "/((?!login|api/auth|api/v1|manifest\\.webmanifest|sw\\.js|swe-worker|icon\\.svg|apple-icon\\.png|icons|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
