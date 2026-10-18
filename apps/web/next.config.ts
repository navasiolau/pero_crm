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

const nextConfig: NextConfig = {
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
  },
  ...(hasExternalCiChecks
    ? {
        eslint: { ignoreDuringBuilds: true },
        typescript: { ignoreBuildErrors: true },
      }
    : {}),
  // Нативный модуль argon2 не бандлим — нужен .node-бинарник в standalone-сборке
  serverExternalPackages: ["@node-rs/argon2", "zod", "@pero/kp-template"],
  webpack(config, { isServer }) {
    if (isServer) {
      // Next15 проверяет opt-out по resolved /node_modules/; workspace realpath вне него.
      // Node require сохраняет __dirname пакета для manifests, шрифтов и шаблонов.
      const templateExternal = ({ request }: { request?: string }, done: (error?: Error | null, result?: string) => void) => {
        if (request === "@pero/kp-template") done(null, "commonjs @pero/kp-template");
        else done();
      };
      const inherited = config.externals === undefined ? [] : Array.isArray(config.externals) ? config.externals : [config.externals];
      config.externals = [templateExternal, ...inherited];
    }
    return config;
  },
  outputFileTracingIncludes: {
    "/kp": ["../../packages/kp-template/assets/**/*", "../../packages/kp-template/*.json"],
    "/kp/**": ["../../packages/kp-template/assets/**/*", "../../packages/kp-template/*.json"],
    "/api/kp/**": ["../../packages/kp-template/assets/**/*", "../../packages/kp-template/*.json"],
    "/api/v1/kp/**": ["../../packages/kp-template/assets/**/*", "../../packages/kp-template/*.json"],
  },
  // Плагины и SDK — TS-пакеты монорепо без отдельной сборки (§14: общая сборка)
  transpilePackages: [
    "@pero/plugin-sdk",
    "@pero/plugin-demo",
  ],
  ...(isWindows
    ? {}
    : {
        // Native CI проверяет тот же standalone-образ, который публикуется.
        output: "standalone",
        // Корень монорепо — для корректной трассировки файлов standalone-сборки
        outputFileTracingRoot: path.join(__dirname, "../../"),
      }),
};

export default withSerwist(nextConfig);
