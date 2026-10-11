# Проверка задачи 128

Дата: 11.10.2026. Ветка `bugfix/128` создана от fa9c8c4; перед реализацией обычным fast-forward обновлена к принятому staging `cd38cb745759becd58dbbad4d6d37afa03f0ab7a`.

## Изменение

Текущий `session.user.id` передаётся от products page через ProductsView в ProductsKanban. Один `currentProductStatusTargets` используется карточкой изделия и обеими досками и проверяет непустой текущий actor ID против `engineerId`. Историческое участие не подменяет назначение. Сервер, денежный расчёт, схема, dependency lockfile и UI-markup не изменены; сохранены price-draft flush карточки, DRAFT-lock, rollback и навигация.

Изменённая доступность drag handle для текущего/бывшего инженера — ожидаемое исправление. Остальные визуальные отличия не допускаются. Исправление autofocus145 и оптимизации142–146 в этот diff не входят.

## Неизменяемый BEFORE

Проверенная фактическая staging-ревизия: `cd38cb745759becd58dbbad4d6d37afa03f0ab7a`. Образ: `sha256:6e8ee62f795ae3c10a4009d8ef8614270db4d757bb833a14a1b3f6ab0ce63154`. Host/DB/mount/W07/source/compiled-action pins проверены до и после. Браузер — отдельный Windows Chromium context, DPR1, zoom100%, colorScheme light.

Артефакты: `D:/Projects/pero_crm_worktrees/improvements-127/apps/web/test-results/frontend-baseline-protocol/runs/c9bb930c-0f23-4fe7-a246-ec5aa2fe32b2/`.

- `receipt.json`: PASS, 18 PNG (manager/engineer × global-products/project-products/product-card × 1440×900/390×844/360×800), все hashes зафиксированы; PNG не заменяются.
- `restore-receipt.private.json`: RESTORED, 12 prefs проверены, 10 не изменялись, 2 восстановлены exact CAS, 0 удалено. 22 business +2 audit/time fingerprints совпадают.
- Unknown ACK0, blocked POST0; 6 проверенных readonly Bell calls. 54 автоматических prefetch остановлены до forward, чтобы baseline не запускал `/my`/getActiveTimer. Это QA-условие одинаково для BEFORE/AFTER; настройки приложения и пользователя не менялись.
- Capture строго viewport, caret скрыт и animations остановлены только на момент снимка; те же условия обязательны для AFTER. Максимальный измеренный document height426953px не доказывает причину инцидента iMac.
- Ранние попытки с неизвестным POST/ошибкой capture завершались STOP и independently verified cleanup; они не являются успешным baseline.

Протокол прошёл независимое ревью: source pins 38 файлов, строгий compiled `getBellData` +[]/known pages, unknown POST/GET и image-fetchproxy запрещены, HMAC checkpoint, genuine Next15.5.20 v2 Flight ACK, unknown response→HOLD без restore. Signed checkpoint/cookies/личные данные не включены в коммит; supporting caller остаётся ignored.

## Локальная проверка

RED: новый `global-kanban-current-engineer.test.ts` показал три ошибки глобальной доски: текущее назначение без participant, прежний participant без назначения и пустой actor. Пять проверок проектной доски/менеджмента уже проходили. После исправления — 8/8 PASS.

SSR tests используют реальные компоненты и callbacks с контролируемыми navigation/action/DnD scheduling boundaries. Это не настоящий drag и не SQL-приёмка.

Новый `global-kanban-current-engineer-component.test.mjs` монтирует реальные React19, DnD-kit и Base UI; подменяются только server action/navigation/toast/list-query boundaries. 8/8 настоящих Chromium pointer проверок: положительный возврат, запрет прежнего участника, rollback по отказу сервера и Escape без записи/навигации, для обеих досок. Минимальная harness CSS задаёт геометрию и не подменяет визуальную staging-приёмку.

```text
pnpm --filter @pero/web exec tsx --test --test-concurrency=1 tests/global-kanban-current-engineer.test.ts tests/global-kanban-current-engineer-component.test.mjs tests/engineer-production-return.test.ts tests/engineer-access.test.ts tests/engineer-access-actions.test.ts tests/product-percentage-ui.test.ts tests/product-draft-boards.test.ts tests/product-draft-core.test.ts tests/product-draft-privacy.test.ts tests/global-product-thumbnail-navigation.test.ts tests/product-card-navigation.test.ts
82 tests, 82 pass, 0 fail, 0 skipped

pnpm --filter @pero/web exec tsc --noEmit --incremental false
PASS

pnpm --filter @pero/web exec eslint src/lib/product-percentage-ui.ts src/app/(app)/products/page.tsx src/app/(app)/products/products-view.tsx src/app/(app)/products/products-kanban.tsx src/app/(app)/projects/[id]/products-tab.tsx src/app/(app)/products/[id]/product-header.tsx tests/global-kanban-current-engineer.test.ts tests/global-kanban-current-engineer-component.test.mjs
PASS

git diff --check
PASS
```

Source diff: 6 UI/lib files; повторные context objects заменены адаптером. Проверка `git diff --name-only -- apps/web/src/server apps/web/prisma pnpm-lock.yaml` пуста. Приложение не запускалось против local PostgreSQL, его exclusive native window130 сохранён.

## Оставшаяся приёмка

- Независимое code review: CODE_REVIEW_GO. Final diff шести source и двух tests проверен; source после review не менялся.
- Native v4 возврат/повтор и полное сравнение frozen completion/PayrollEntry на существующей разрешённой БД: NOT_RUN. Изолированные fixtures не заменяют PostgreSQL.
- Развёртывание UI128 на фактическом staging SHA/образе и здоровое приложение: NOT_RUN.
- AFTER18 PNG на тех же приватных actors/paths/data, проверка допустимого только drag affordance и остальных pixel/behavior invariants: NOT_RUN.
- Настоящий owned positive/negative staging drag и карточка с reviewed fixture/cleanup: NOT_RUN. BEFORE-протокол не разрешает business CRUD или перетаскивание в существующих business records.
- iMac недоступен: задача141 остаётся BLOCKED_DEVICE_UNAVAILABLE; причина и исправление его инцидента не подтверждены.

Main и production в этом изменении не затрагиваются.

## Commit authorization and preflight

Владелец напрямую разрешил необходимые коммиты по всему утверждённому плану: «Разрешаю коммиты по всему плану». Trusted user message01a129b2-c4bb-7303-a225-73033254f4ba прочитан через app API. Прежний automatic rejection произошёл до выполнения commit; разрешение проверено перед повтором. Main/production и самостоятельный push/merge автором не разрешены.

Precommit повторно: strict OpenSpec PASS, git diff --check PASS, scope только6reviewed source +2tests +6OpenSpec files. Ignored session/caller/PNG/checkpoint/env не включаются.82targeted +8real pointer contracts, tsc и scoped lint из секции local verification остаются PASS; source не менялся, DB/stage acceptance остаётся NOT_RUN.