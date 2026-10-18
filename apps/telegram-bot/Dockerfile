# syntax=docker/dockerfile:1
# Telegram-бот — изолированный сервис PERO CRM (LXC tgbot).
# Zero runtime-dependencies: в рантайме нужен только node + dist.

FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/plugins/demo/package.json packages/plugins/demo/
COPY apps/web/package.json apps/web/
COPY apps/telegram-bot/package.json apps/telegram-bot/
COPY apps/kp-renderer/package.json apps/kp-renderer/
COPY packages/kp-template/package.json packages/kp-template/
RUN pnpm install --frozen-lockfile --filter @pero/telegram-bot
COPY apps/telegram-bot apps/telegram-bot
RUN pnpm --filter @pero/telegram-bot build

FROM base AS runtime
ENV NODE_ENV=production
# dist не имеет внешних зависимостей — node_modules в образ не попадают
USER node
CMD ["node", "dist/index.js"]

# Только CI передаёт проверенный plain JS через именованный context.
FROM runtime AS ci-runner
COPY --from=pero-bot-dist /dist ./dist

# Последняя/default стадия сохраняет обычную локальную сборку из исходников.
FROM runtime AS runner
COPY --from=build /app/apps/telegram-bot/dist ./dist
