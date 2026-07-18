# PERO CRM v2

CRM для производства корпусной мебели на заказ. Современная замена «Бизнес в плюсе».

Стек: **Next.js 15 (App Router) · TypeScript strict · PostgreSQL 16 · Prisma · Auth.js v5 · shadcn/ui · Tailwind v4 · PWA (Serwist)**.

Полный план: [PERO CRM v2 — План реализации базовой CRM.md](./PERO%20CRM%20v2%20—%20План%20реализации%20базовой%20CRM.md)

## Быстрый старт (dev)

Требования: Node 22, pnpm 11, Docker.

```bash
pnpm install                    # установка зависимостей (единый lockfile в корне)
docker compose up -d postgres   # PostgreSQL 16 на порту 5433
cp apps/web/.env.example apps/web/.env   # и заполнить AUTH_SECRET (openssl rand -base64 32)
pnpm db:migrate                 # миграции Prisma
pnpm db:seed                    # демо-пользователи (6 ролей)
pnpm dev                        # http://localhost:3000
```

> Порт **5433**, а не 5432: на 5432 может работать postgres проекта `legacy_export` (его не трогаем).

## Демо-пользователи

Пароль у всех: **`pero-demo-2026`**

| Email | Имя | Роль | Схема оплаты | После входа |
|---|---|---|---|---|
| `admin@pero.local` | Администратор | ADMIN | 3% с оборота | Дашборд |
| `director@pero.local` | Директор | DIRECTOR | без расчёта | Дашборд |
| `manager@pero.local` | Менеджер | MANAGER | — | Дашборд |
| `engineer@pero.local` | Инженер | ENGINEER | 5% от стоимости | Дашборд |
| `worker@pero.local` | Работник | WORKER | сдельная | «Мои задачи» |
| `mounter@pero.local` | Монтажник | MOUNTER | сдельная | «Мои задачи» |

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` | dev-сервер Next.js (Turbopack) |
| `pnpm build` | prod-сборка (webpack — нужен для Serwist) |
| `pnpm start` | prod-сервер |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:deploy` | `prisma migrate deploy` (prod) |
| `pnpm db:generate` | `prisma generate` |
| `pnpm db:seed` | seed демо-пользователей (идемпотентный) |

## Структура монорепо

```
pero_crm_v2/
├── apps/
│   └── web/                  # @pero/web — приложение Next.js
│       ├── prisma/           # схема, миграции, seed
│       ├── public/icons/     # иконки PWA (генерируются scripts/generate-icons.mjs)
│       ├── scripts/          # служебные скрипты
│       └── src/
│           ├── app/
│           │   ├── (app)/    # защищённая группа роутов (app shell)
│           │   │   ├── settings/    # Настройки: modules/ (плагины), api/ (токены)
│           │   │   └── changelog/   # журнал изменений (§5)
│           │   ├── api/v1/   # публичный REST API (Bearer-токены) + openapi.json
│           │   └── login/    # страница входа
│           ├── components/   # app shell + shadcn/ui + plugins/ (рендер слотов)
│           ├── server/       # plugins/ (плагинное ядро §14), api/, require-role
│           ├── lib/          # prisma-синглтон, навигация, утилиты
│           ├── instrumentation.ts # синхронизация реестра плагинов при старте
│           ├── auth.ts       # Auth.js (credentials)
│           ├── auth.config.ts# edge-safe конфиг Auth.js
│           └── middleware.ts # защита роутов + ролевые ограничения
├── packages/
│   ├── plugin-sdk/           # @pero/plugin-sdk — SDK: манифест, слоты, контекст
│   └── plugins/              # плагины (§14); demo — эталонный
├── docker-compose.yml        # postgres (5433) + app + caddy (профиль prod)
└── Caddyfile
```

## Модули (плагины, §14)

- Управление: **Настройки → Модули** (админ/директор) — вкл/выкл одной кнопкой, автоформа настроек, команды, журнал запусков.
- Точки расширения: UI-слоты (`dashboard.widget`, `project.tab`, `project.action`, `task.action`, `settings.page`), шина доменных событий (outbox), команды (UI/cron/REST).
- REST API `/api/v1` с Bearer-токенами: **Настройки → API и токены**; OpenAPI — `/api/v1/openapi.json`.
- Установка ручная: пакет в `packages/plugins/<id>/` + запись в `apps/web/src/server/plugins/registry.ts`. Эталон — `packages/plugins/demo`.

## Prod (docker)

```bash
cp .env.example .env   # AUTH_SECRET, CADDY_DOMAIN
docker compose --profile prod up -d --build
```

Caddy поднимает HTTPS (обязателен для PWA) и проксирует на `app:3000`; при старте контейнера применяются миграции (`prisma migrate deploy`).
