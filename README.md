# PERO CRM v2

CRM для производства корпусной мебели на заказ: клиенты и заказы, изделия,
работы и задачи, файлы, коммуникации, финансы, зарплата и склад.

Стек: Next.js 15 (App Router), React 19, TypeScript strict, PostgreSQL,
Prisma 6, Auth.js v5, shadcn/ui / Base UI, Tailwind v4, Serwist.
Требования: Node.js 22+, pnpm 11; единый lockfile в корне.

## Документация

- [AGENTS.md](AGENTS.md) — правила разработки, GitFlow, БД и безопасности.
- [План улучшений](CRM_IMPROVEMENTS_PLAN.md) — действующий план работ.
- [Основные specs](openspec/specs) и [changes](openspec/changes) — требования,
  решения и результаты проверок отдельных задач.
- [Архитектура](ARCHITECTURE.md) — технические и инфраструктурные решения.
- [Развёртывание](docs/DEPLOY.md), [production](PROD_DEPLOYMENT.md) и
  [pull-модель деплоя](deploy/README.md) — операторские инструкции.
- [Telegram-бот](deploy/telegram-bot/README.md), [S3](docs/S3.md) и
  [NAS](docs/NAS.md) — отдельные сервисы.
- [Отчёт импорта legacy](apps/web/scripts/import-legacy/REPORT.md) — результаты
  завершённого переноса; исходный экспорт хранится вне репозитория.

Правила владельца в AGENTS.md имеют приоритет над историческими указаниями
в документах и QA-скриптах. Оригинальные планы ранних этапов удалены; требования
текущих задач находятся в действующем плане и OpenSpec.

## Модель и доступ

- `Project` — заказ клиента; `Product` — позиция заказа с количеством одинаковых
  экземпляров. Цена изделия задаётся за единицу, сумма партии учитывает количество.
- Инженер, изображения, файлы, работы и материалы относятся к конкретному изделию;
  на проекте доступны общие данные и итоговые показатели.
- Роли сотрудника — массив `User.roles`. Права объединяются; ADMIN и DIRECTOR
  используются отдельно. Ролевые наборы определены в
  [roles.ts](apps/web/src/lib/roles.ts), ограничения данных — в
  [серверной политике](apps/web/src/server/access/visibility.ts).
- Финансовые суммы хранятся как Decimal; выплаты, начисления и складские движения
  сохраняют необходимые снимки и аудит. Процентная оплата изделия реализована в
  [product-percentage-pay](apps/web/src/server/product-percentage-pay).
- Вход — credentials / JWT с серверной проверкой сессии. REST `/api/v1`
  использует Bearer-токены и проверку scopes в каждом route.
- Загрузки обслуживаются защищёнными routes. При настроенном S3 используется MinIO;
  для локального хранения предусмотрен файловый fallback.

## Структура

| Каталог | Назначение |
|---|---|
| `apps/web/src/app` | Страницы App Router и API |
| `apps/web/src/components` | Интерфейс и переиспользуемые компоненты |
| `apps/web/src/server` | Доменные запросы, действия и права |
| `apps/web/src/lib` | Общие политики, форматирование и утилиты |
| `apps/web/prisma` | Схема и история миграций |
| `apps/web/tests` | Unit/DI, DB/runtime и browser-проверки |
| `apps/telegram-bot` | Изолированный сервис бота, long polling + CRM REST API |
| `packages/plugin-sdk` | Контракт плагинов |
| `packages/plugins` | Установленные плагины demo и file-stages |
| `deploy` | Compose, CI-приёмка и операторские инструкции |

## Локальная работа

Используется существующий разрешённый PostgreSQL на порту **5433**.
Порт 5432 принадлежит legacy-проекту `D:\legacy_export`.
Базовые переменные описаны в [.env.example](.env.example). Для локального web
задаются `DATABASE_URL` и `AUTH_SECRET`; секреты хранятся в ignored env.

После подготовки окружения:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev
```

Приложение открывается на http://localhost:3000. Миграции выполняются в рамках
согласованной задачи. Seed, reset, legacy-import и создание нового стенда
требуют отдельного поручения; seed существующих рабочих данных не запускать.

## Команды и проверки

| Команда из корня | Назначение |
|---|---|
| `pnpm dev` | Dev-сервер Next.js |
| `pnpm build` / `pnpm start` | Production-сборка / запуск |
| `pnpm lint` | ESLint |
| `pnpm --filter @pero/web test` | Unit/DI-тесты web |
| `pnpm --filter @pero/web exec tsc --noEmit --incremental false` | Типизация web |
| `pnpm --filter @pero/telegram-bot test` | Сборка и тесты бота |
| `pnpm --filter @pero/telegram-bot typecheck` | Типизация бота |
| `pnpm db:generate` | Генерация Prisma Client |
| `pnpm db:migrate` / `pnpm db:deploy` | Миграции local / deploy |
| `openspec validate <change> --strict` | Проверка OpenSpec change |

Prisma Client генерируется перед типизацией и сборкой. DB/runtime/browser-проверки
имеют собственные guards и инструкции в tests и OpenSpec; unit-тесты и build
не заменяют фактическую приёмку сценария.

## Выпуск и локальные материалы

Работа начинается от свежего staging в ветке одной задачи. Далее идут local,
обычный merge в staging, CI и приёмка фактически развёрнутой ревизии.
Main получает весь принятый staging по прямому указанию владельца.
CI собирает образы web и бота в GHCR; серверные watchers применяют их по pull-модели.
Полные правила разрешений и проверки выпуска находятся в AGENTS.md.

Локальные env, загрузки, браузерные артефакты и тестовые `test_bazis_models`
не включаются в Git. B3D-модели сохранены на диске и исключены из Docker-контекста.
