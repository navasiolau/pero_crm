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
  - `src/components/` — оболочка на официальных блоках shadcn (`dashboard-01`, `login-03`, стиль base-nova): `app-shell.tsx` (SidebarProvider), `app-sidebar.tsx`, `nav-main.tsx`, `site-header.tsx`, `nav-user.tsx`, `theme-toggle.tsx` (бинарный light/dark), `logo.tsx` (фирменное перо v1, currentColor, без подложки), виджеты дашборда `section-cards.tsx`, `chart-area-interactive.tsx` (recharts), `recent-projects.tsx`, `login-form.tsx`, `stub-page.tsx` (empty-state заглушек)
  - `src/components/ui/` — примитивы shadcn (sidebar, card, table, chart, field и т.д.), ставить через `pnpm dlx shadcn@latest add <name>` из `apps/web`
  - `src/server/plugins/` — плагинное ядро (§14): `registry.ts` (статический реестр манифестов — ручная установка), `sync.ts` (upsert Plugin при старте, вызов из `src/instrumentation.ts`), `slots.ts` + `src/components/plugins/plugin-slot.tsx` (UI-слоты через next/dynamic, ErrorBoundary на вклад), `events.ts` (шина DomainEvent — outbox, синхронная доставка + `dispatchPendingEvents` для cron), `context.ts` (PluginContext: db, logger, audit, emit, requirePermission), `changelog.ts` (журнал изменений §5), `tokens.ts` (Bearer-токены API), `actions.ts` (server actions: toggle/settings/command/token)
  - `src/app/api/v1/` — публичный REST API (Bearer pero_…, scope read/write/admin): `/`, `/plugins`, `/plugins/:id/commands/:cmd` (POST), `/events`, `/events/dispatch` (POST), `/openapi.json`. **Исключён из middleware-матчера** — при добавлении роутов не забывать проверять scope.
  - `src/app/(app)/settings/` — настройки (ADMIN/DIRECTOR): `modules/` (список + `[id]` детальная: автоформа настроек, команды, журнал запусков), `api/` (токены + документация)
  - `src/app/(app)/changelog/` — журнал изменений с фильтрами (ADMIN/DIRECTOR)
  - `src/app/(app)/projects/` — проекты (фаза 2): канбан (`kanban-board.tsx`, dnd-kit, оптимистично с откатом) / таблица, вид в UserPreference; `[id]/` — карточка со вкладками (Общее, Работы и задачи, Файлы, Коммуникации, Финансы*, История + project.tab-слоты); `stage-form-dialog.tsx` — мини-формы Отказа/Рекламации при dnd (§6)
  - `src/app/(app)/clients/` — клиенты; `my/` — «Мои задачи» работника; `notifications/` — лента + настройка типов (§6.1)
  - `src/server/` — доменные действия: `projects/`, `clients/`, `tasks/`, `files/`, `communications/`, `notifications/` (notify.ts — фан-аут по §6.1), `preferences.ts` (UserPreference §7), `require-role.ts`, `plugins/` (ядро §14)
  - `src/app/api/files/` — загрузка (upload, sharp-превью) и отдача ([id], проверка прав); хранилище `apps/web/uploads/<projectId>/` (§13, gitignored)
  - `src/lib/stages.ts` — этапы воронки §6 + «дней на этапе» + `stageStyles` (цветовая дифференциация: служебные состояния — Рекламация amber, Пауза slate, Отказ red — вне нормального воркфлоу, выделяются всегда); `src/lib/format.ts` — суммы; `src/lib/uploads.ts` — корень хранилища
  - `src/components/ui/searchable-select.tsx` — комбобокс с поиском (поле фильтра над списком) — ОБЯЗАТЕЛЕН для длинных списков (клиенты, сотрудники); у селектов должны быть дефолты
  - `src/components/ui/data-table.tsx` — универсальная таблица: поиск, сортировка по клику на заголовок, пагинация (10/20/50/100 + стрелки). Применять для ВСЕХ табличных списков сущностей
  - `src/components/omnisearch.tsx` — глобальный поиск (Ctrl+K, палитра как в IDE) по `/api/search`: проекты, задачи, клиенты с учётом видимости §4
  - `src/components/file-viewer.tsx` — просмотрщик вложений: изображения/видео — лайтбокс, PDF — новая вкладка, прочие форматы (b3d и т.п.) — только скачивание; хук `useFileViewer()`
  - `src/components/task-dialog.tsx` — карточка задачи (max-w-2xl, подписанные поля: тип, срок, исполнитель, создатель, создана; файлы кликабельны через FileViewer; просмотр/правка для ADMIN/DIRECTOR/MANAGER; выполненная — только просмотр); задачи кликабельны везде; без исполнителя = «Черновик» со значком, тип и срок обязательны
  - `src/app/(app)/settings/users/` — управление сотрудниками (ФИО, должность, телефон, telegram — действия и журнал привязываются к ЧЕЛОВЕКУ, не к роли)
  - Клиент: `name` = Имя (или «ООО Альфа» для юрлица), `lastName`, `middleName`; поля «Компания» НЕТ; отображение через `displayClientName` из `src/lib/labels.ts` («Фамилия Имя Отчество»); окно просмотра по клику на строку — обязательно для всех сущностей
  - «use server»-файлы экспортируют ТОЛЬКО async-функции — подписи/константы выносить в `src/lib/labels.ts` и подобные
  - `prisma/` — схема (User, Plugin-ядро, Client, Project, ProjectStageHistory, Task, File, Communication, Notification(+Preference), UserPreference, ChangeLog), миграции, seed (6 ролей + демо-проекты)
- `packages/plugin-sdk` (`@pero/plugin-sdk`) — SDK плагинов: манифест `definePlugin`, слоты (`dashboard.widget`, `project.tab`, `project.action`, `task.action`, `settings.page`), PluginContext, CURRENT_API_VERSION (совместимость N и N-1)
- `packages/plugins/<id>` — плагины; сейчас `demo` (виджет, вкладка в проекте, команда «Пинг», хуки). Новый плагин: пакет с `plugin.ts` → workspace-зависимость в apps/web → `transpilePackages` → реестр `src/server/plugins/registry.ts`

## Конвенции

- UI: shadcn/ui (стиль `base-nova`, Base UI) + Tailwind v4, тема dark/light через `next-themes`, mobile-first. Шрифт — Onest (next/font, subsets latin+cyrillic, переменная `--font-onest` на `<html>`; Inter НЕ использовать).
- Версии пакетов pinned (Next 15.5.20, Prisma 6.19.3 — НЕ 7.x, next-auth 5.0.0-beta.31, @serwist/next 9.5.11); не обновлять без необходимости.
- Секреты — только в `.env` (gitignored); примеры — в `.env.example`.
- Деньги — `Decimal`; сущности из legacy несут `legacyId` + `legacyTable` (§8).
