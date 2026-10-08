# Local QA — 08.10.2026

Ветка bugfix/114, базовый staging SHA 20a049b2faf7f60023d9315e2ff0e10fdbfc2cf1. Реализация и результаты локальные; staging-приёмка ещё не выполнена.

- RED: новый browser geometry contract на прежней реализации получил landscape 300×75 вместо ожидаемых 300×400, fit=contain.
- GREEN: `pnpm --filter @pero/web exec node tests/kanban-image-natural-browser.mjs` — PASS, 21 группа проверок. Реальные ProductKanbanCard/ProjectKanbanCard и Tailwind CSS; synthetic PNG transport без обращений/изменений БД. Исходники 1600×400, 800×800 и 200×2000; viewport 1440×900, 390×844, 360×800. Проверены кадр 3:4, отсутствие полей, центрированный cover, delayed state обоих компонентов, ошибка в той же области, компактная карточка без эскиза, resize/cache, клик ровно один раз без bubbling, disabled dragging и полноэкранный оригинал. Отдельный detail Hero сохраняет contain и preview=cover.
- `pnpm --filter @pero/web exec tsx --test tests/product-hero.test.ts tests/product-card-navigation.test.ts tests/project-kanban-card-layout.test.ts` — PASS 18/18.
- `pnpm db:generate` — PASS, только генерация ignored Prisma Client без подключения к БД. `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — PASS.
- `pnpm --filter @pero/web exec eslint src/components/product-kanban-card.tsx src/components/project-kanban-card.tsx tests/product-hero.test.ts tests/kanban-image-natural-browser.mjs` — PASS.
- `openspec validate kanban-cover-3x4 --strict` и `git diff --check` — PASS.
- Визуально просмотрены desktop/mobile fullpage и viewport PNG: кадры равны, центральный круг не вытянут, картинка доходит до края; подробный вертикальный эскиз показан целиком.

Ignored artifacts: `.playwright-mcp/kanban114/receipt.json`, `cards-{1440,390,360}.png`, `viewport-cards-{1440,390,360}.png`. Browser script сохранил прежнее имя существующего harness; его требование естественной высоты заменено согласованным 3:4.

Коммиты, push, merge, deploy, миграции и изменения БД не выполнялись. Задача передана основному агенту для независимого review; staging пункт 2.3 остаётся открытым до приёмки фактически развёрнутой ревизии.