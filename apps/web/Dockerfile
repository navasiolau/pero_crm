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
RUN pnpm install --frozen-lockfile --filter @pero/web...
COPY packages packages
COPY apps/web apps/web
# Значения-заглушки: нужны только на время сборки (prerender), в образ не попадают
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    AUTH_SECRET="build-time-dummy"
ARG GITHUB_ACTIONS=false
ARG PERO_CI_EXTERNAL_CHECKS=0
ARG PERO_CI_CACHE_ID=pero-next-local
RUN --mount=type=cache,id=${PERO_CI_CACHE_ID},target=/app/apps/web/.next/cache,sharing=locked \
    pnpm --filter @pero/web exec prisma generate \
    && pnpm --filter @pero/web build

# Свежие types и action manifest принадлежат той же сборке, что и runtime-образ.
FROM scratch AS ci-metadata
COPY --from=build /app/apps/web/.next/types /types
COPY --from=build /app/apps/web/.next/BUILD_ID /BUILD_ID
COPY --from=build /app/apps/web/.next/server/server-reference-manifest.json /server/server-reference-manifest.json

# --- Рантайм ---
FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# prisma CLI — для `migrate deploy` при старте контейнера
RUN npm i -g prisma@6.19.3
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
COPY apps/web/prisma apps/web/prisma
EXPOSE 3000
CMD ["sh", "-c", "prisma migrate deploy --schema apps/web/prisma/schema.prisma && node apps/web/server.js"]
