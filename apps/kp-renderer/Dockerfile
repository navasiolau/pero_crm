# syntax=docker/dockerfile:1
# Отдельный образ Chromium; web остаётся на прежнем Node 22 Alpine.
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libx11-6 fonts-liberation poppler-utils \
    && rm -rf /var/lib/apt/lists/* && corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/telegram-bot/package.json apps/telegram-bot/
COPY apps/kp-renderer/package.json apps/kp-renderer/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/plugins/demo/package.json packages/plugins/demo/
COPY packages/kp-template/package.json packages/kp-template/
RUN --mount=type=cache,id=pero-kp-pnpm11-glibc,target=/pnpm-store,sharing=locked \
    pnpm install --frozen-lockfile --prod --filter @pero/kp-renderer... --store-dir /pnpm-store --package-import-method=copy
COPY apps/kp-renderer apps/kp-renderer
COPY packages/kp-template packages/kp-template
ENV NODE_ENV=production PORT=3100
USER node
WORKDIR /app/apps/kp-renderer
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3100/health',{headers:{'x-pero-renderer-key':process.env.PERO_KP_RENDERER_SECRET},signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=384", "server.cjs"]
