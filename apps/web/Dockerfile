# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat && corepack enable pnpm
WORKDIR /app

# --- Сборка ---
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Все workspace manifests нужны для frozen lockfile; исходники идут после install,
# чтобы изменение плагина не заставляло повторно устанавливать зависимости.
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/plugins/demo/package.json packages/plugins/demo/
COPY apps/web/package.json apps/web/
COPY apps/telegram-bot/package.json apps/telegram-bot/
COPY apps/kp-renderer/package.json apps/kp-renderer/
COPY packages/kp-template/package.json packages/kp-template/
RUN --mount=type=cache,id=pero-web-pnpm11-musl,target=/pnpm-store,sharing=locked \
    pnpm install --frozen-lockfile --filter @pero/web... --store-dir /pnpm-store --package-import-method=copy
COPY packages packages
COPY apps/web apps/web
# Значения-заглушки: нужны только на время сборки (prerender), в образ не попадают
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    AUTH_SECRET="build-time-dummy" \
    PNPM_CONFIG_STORE_DIR=/pnpm-store
ARG GITHUB_ACTIONS=false
ARG PERO_CI_EXTERNAL_CHECKS=0
ARG PERO_CI_CACHE_ID=pero-next-local
RUN --mount=type=cache,id=${PERO_CI_CACHE_ID},target=/app/apps/web/.next/cache,sharing=locked \
    pnpm --filter @pero/web exec prisma generate \
    && pnpm --filter @pero/web build \
    && test -s apps/web/public/sw.js \
    && cp -a apps/web/.next/types apps/web/.next/standalone/apps/web/.next/types

# --- Рантайм ---
FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# prisma CLI — для `migrate deploy` при старте контейнера
RUN npm i -g prisma@6.19.3
COPY --from=build /app/apps/web/.next/standalone ./
# Externalized пакет использует CJS entry/limits и динамические fs assets вне tracing.
COPY --from=build /app/packages/kp-template/index.cjs /app/packages/kp-template/limits.cjs /app/packages/kp-template/package.json /app/packages/kp-template/source-manifest.json /app/packages/kp-template/fonts-manifest.json ./packages/kp-template/
COPY --from=build /app/packages/kp-template/assets ./packages/kp-template/assets
# Bare require из apps/web использует стандартный ancestor node_modules.
RUN mkdir -p /app/node_modules/@pero \
    && test ! -e /app/node_modules/@pero/kp-template \
    && test ! -L /app/node_modules/@pero/kp-template \
    && ln -s ../../packages/kp-template /app/node_modules/@pero/kp-template
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
COPY apps/web/prisma apps/web/prisma
EXPOSE 3000
CMD ["sh", "-c", "prisma migrate deploy --schema apps/web/prisma/schema.prisma && node apps/web/server.js"]
