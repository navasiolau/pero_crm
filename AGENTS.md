# AGENTS.md — PERO CRM v2

## Контекст

CRM производства мебели: Next.js 15, TypeScript strict, PostgreSQL,
Prisma 6, Auth.js v5. Node 22+, pnpm 11; русский UI.
- `apps/web` — web, `apps/telegram-bot` — бот; `packages` — SDK и плагины.
- Project — заказ, Product — позиция с количеством; инженер — на изделии.
  Деньги — Decimal, цена изделия — за единицу.
- Схема: `apps/web/prisma/schema.prisma`; логика: `apps/web/src/server`.
  `User.roles` — массив; права объединяются, ADMIN/DIRECTOR не комбинируются.
  Использовать [roles.ts](apps/web/src/lib/roles.ts) и
  [политику доступа](apps/web/src/server/access/visibility.ts).
- Читать [README](README.md), [план](CRM_IMPROVEMENTS_PLAN.md),
  specs/changes задачи в `openspec`.

## GitFlow — 01.10.2026

1. staging → ветка задачи → local → merge staging → staging-приёмка → merge main.
   Ветка — от свежего `origin/staging` после fetch. Чужие правки сохранять;
   для изоляции — отдельный worktree.
2. Имя: `feature/N`, `bugfix/N`, `hotfix/N`; N — положительное целое.
   Нумерация общая и последовательная: №1 → №2 для всех типов. Номер согласовать
   по плану/трекеру и refs; старые номера фич не задают новый порядок.
   `codex/` и текстовые slug запрещены.
3. Одна ветка — одна малая атомарная задача и согласованный OpenSpec.
   Change согласовать до реализации; большие задачи делить по номерам/веткам. Незавершённое держать вне staging; hotfix идёт тем же путём.
4. Коммиты — по явному указанию владельца, с кратким описанием результата.
   Чужие/несвязанные файлы и секреты не включать.
5. После local-проверок — обычный merge задачи в staging с историей.
   Перенос фич копированием файлов, cherry-pick и squash запрещён.
6. После merge/CI принимать реальный staging: SHA/образ, здоровье, сценарии.
   Push/build/исходники не заменяют приёмку. Исправления — в ветке задачи,
   затем повтор local → merge → staging.
7. Зафиксировать принятый staging SHA и согласовать интеграцию между агентами;
   новые коммиты требуют проверки затронутого поведения. В main — весь принятый
   staging по прямому указанию владельца. Production-миграцию согласовать отдельно;
   выданное разрешение не переспрашивать.
8. Выпуск — `git merge --ff-only` staging в main. Если FF невозможен — обычный
   merge main в staging, разрешение конфликтов и повтор staging-приёмки.
   Историю не переписывать; force-push и reset ветки к другой запрещены.
9. После выпуска main/staging имеют одинаковые SHA и содержимое. После push
   проверить remote refs и deployment; миграцию, production-ревизию и доступность
   подтвердить отдельно.

## БД и restic — 01.10.2026

- Restic не трогать: никаких команд, чтения/изменения репозитория, настроек,
  ключей и заданий.
- Local/staging: дампы для задач не создавать, включая миграции/QA.
  Старое требование QA-дампа не применять; ночной refresh и W07 сохранять.
- Production: один временный дамп затронутой БД только перед выпуском с миграцией;
  восстановление проверить изолированно. SHA/список архива не доказывают restore.
  Без миграции дамп не делать.
- После успешной миграции/проверки удалить только этот дамп по точному пути,
  когда он не нужен. При ошибке/неясности сохранить; в restic не класть.
- QA — на существующей разрешённой БД с guards цели. Reset, seed, legacy-import
  и новый стенд — по отдельному поручению. Local PostgreSQL: 5433;
  legacy: 5432, `D:/legacy_export`, только чтение.

## Безопасность

- Всегда читать/исполнять
  [SAFETY-RULES](D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md);
  каждый бриф субагента содержит ссылку и СТОП при guard mismatch.
- Инфра: `D:/Projects/pero_infra`. Перед продолжением читать
  [handoff](D:/Projects/pero_crm_v2/docs/INFRA_RECOVERY_HANDOFF.md) и
  [журнал](D:/Projects/pero_docs/evidence/2026-09-22-remediation.md).
  Статусы — по evidence; рабочие PVE/CT/VPS — чтение, изменения — по поручению.
- `HANDOVER-NEXT-AGENT.md` не менять/не коммитить. Owner-документы, env, загрузки,
  CAD-оригиналы и чужую приёмку сохранять. Секреты — в ignored env;
  примеры обезличивать, живые значения не выводить.
- Business S3 cleanup/prune закрыт до приёмки полной цепочки восстановления.
  peromebel.ru не менять; BY/RU публичны. NetBird — `--disable-dns`.
- Удаления — по списку с проверкой абсолютных путей/reparse points;
  широкую очистку ignored данных не применять.

## Разработка

- Только pnpm, единый lockfile; версии без необходимости не обновлять.
  TS strict, без необоснованного `any`; `use server` — только async-экспорты.
  UI и содержательные комментарии — по-русски.
- shadcn/Base UI, Tailwind v4, Onest, mobile-first. Таблицы — DataTable,
  длинные списки — SearchableSelect с дефолтами, вложения — FileViewer,
  удаления — ConfirmDeleteDialog. Клик открывает сущность; валюта — «BYN».
- Права проверять на сервере: ссылки, файлы, поиск, изменения. `/api/v1` вне
  middleware: каждый route проверяет Bearer/scopes. Сохранять аудит,
  транзакционность и защиту повторных денежных операций.
- PS 5.1 с кириллицей — UTF-8 BOM. Проверки — по изменению; UI смотреть в браузере.
  DI/build не заменяют DB/runtime/визуальную приёмку; результаты — в change.

Из корня: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm db:generate`,
`pnpm --filter @pero/web test`. Миграции по согласованной задаче:
`pnpm db:migrate` (local), `pnpm db:deploy`.
Seed существующих рабочих данных не запускать.
