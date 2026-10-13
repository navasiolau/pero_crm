import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import withSerwistInit from "@serwist/next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

// standalone нужен для Docker-образа (Linux). На Windows его сборка падает:
// Next копирует traced-файлы через symlink, а без Developer Mode NTFS-symlink
// недоступен (EPERM). Поэтому standalone включаем только на не-Windows платформе
// (локальная проверка prod-сборки на Windows идёт обычной .next-сборкой).
const isWindows = process.platform === "win32";

// В GitHub CI lint проверяется отдельно, а полный tsc — после свежих .next/types.
// Обычные local/Docker build без CI args сохраняют встроенные проверки Next.
const hasExternalCiChecks =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.PERO_CI_EXTERNAL_CHECKS === "1";
const omitCiStandalone =
  hasExternalCiChecks && process.env.PERO_CI_NATIVE_BUILD === "1";

const nextConfig: NextConfig = {
  ...(hasExternalCiChecks
    ? {
        eslint: { ignoreDuringBuilds: true },
        typescript: { ignoreBuildErrors: true },
      }
    : {}),
  // Нативный модуль argon2 не бандлим — нужен .node-бинарник в standalone-сборке
  serverExternalPackages: ["@node-rs/argon2", "zod"],
  // Плагины и SDK — TS-пакеты монорепо без отдельной сборки (§14: общая сборка)
  transpilePackages: [
    "@pero/plugin-sdk",
    "@pero/plugin-demo",
  ],
  ...(isWindows
    ? {}
    : {
        // Native CI запускает next start из полной .next. Local и Docker CI
        // сохраняют standalone-сборку для production-образа.
        ...(omitCiStandalone ? {} : { output: "standalone" }),
        // Корень монорепо — для корректной трассировки файлов standalone-сборки
        outputFileTracingRoot: path.join(__dirname, "../../"),
      }),
};

export default withSerwist(nextConfig);
