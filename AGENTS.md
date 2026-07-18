# AGENTS.md — правила для агентов

## Проект

PERO CRM v2 — CRM для производства корпусной мебели на заказ (русскоязычный UI).
Полный план: `PERO CRM v2 — План реализации базовой CRM.md` в корне (роли — §4, модель — §8, интерфейс — §15, архитектура — §16, фазы — §18).

## Жёсткие правила

- **НЕ трогать `legacy_export/`** — там работает другой агент (отдельный docker-проект `pero_legacy_pg`).
- Наш PostgreSQL — на порту **5433** (5432 может быть занят legacy).
- Менеджер пакетов — **pnpm 11** (workspaces), единый lockfile в корне. npm/yarn не использовать.
- Весь пользовательский UI-текст — **по-русски**. Код и комментарии к неочевидным решениям — по-русски/по существу.
- **TypeScript strict**, без `any` без необходимости.
- **Коммиты не делать** без явного указания владельца.

## Команды (из корня)

- `pnpm install` — установка зависимостей
- `docker compose up -d postgres` — БД
- `pnpm db:migrate` / `pnpm db:seed` — миграции / демо-данные
- `pnpm dev` — dev-сервер; `pnpm build` — prod-сборка (webpack, нужен Serwist)
- `pnpm lint` — ESLint

## Структура

- `apps/web` (`@pero/web`) — приложение Next.js 15 (App Router, `src/`, алиас `@/*`)
  - `src/auth.ts` + `src/auth.config.ts` — Auth.js v5 (credentials + JWT); `src/middleware.ts` — защита роутов и ролевые ограничения (`/finance`, `/changelog`, `/settings` — только ADMIN/DIRECTOR)
  - `src/app/(app)/` — защищённые разделы с app shell; `src/app/login/` — вход
  - `src/lib/nav.ts` — навигация: видимость пунктов по ролям + группы сайдбара (`main`/`manage`)
  - `src/components/` — оболочка на официальных блоках shadcn (`dashboard-01`, `login-03`, стиль base-nova): `app-shell.tsx` (SidebarProvider), `app-sidebar.tsx`, `nav-main.tsx`, `site-header.tsx`, `nav-user.tsx`, `theme-toggle.tsx` (бинарный light/dark), `logo.tsx` (фирменное перо на лаймовом квадрате, как в v1), виджеты дашборда `section-cards.tsx`, `chart-area-interactive.tsx` (recharts), `recent-projects.tsx`, `login-form.tsx`, `stub-page.tsx` (empty-state заглушек)
  - `src/components/ui/` — примитивы shadcn (sidebar, card, table, chart, field и т.д.), ставить через `pnpm dlx shadcn@latest add <name>` из `apps/web`
  - `prisma/` — схема (пока только `User`), миграции, seed
- `packages/` — будущие пакеты/плагины (§14 плана)

## Конвенции

- UI: shadcn/ui (стиль `base-nova`, Base UI) + Tailwind v4, тема dark/light через `next-themes`, mobile-first. Шрифт — Onest (next/font, subsets latin+cyrillic, переменная `--font-onest` на `<html>`; Inter НЕ использовать).
- Версии пакетов pinned (Next 15.5.20, Prisma 6.19.3 — НЕ 7.x, next-auth 5.0.0-beta.31, @serwist/next 9.5.11); не обновлять без необходимости.
- Секреты — только в `.env` (gitignored); примеры — в `.env.example`.
- Деньги — `Decimal`; сущности из legacy несут `legacyId` + `legacyTable` (§8).
