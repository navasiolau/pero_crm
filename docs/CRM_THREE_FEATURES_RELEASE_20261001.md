# Pre-push frozen release manifest — CRM, 01.10.2026

> Снимок состояния до main push. На момент подготовки локальные проверки selective release-кандидата завершены, main push/CI/deploy ожидаются. Фактическую доставку подтверждать по Git `main` ref и итоговому receipt. Production результат не проверен; его принимает владелец.

## Основание и состав

База релиза: `2cac6f3c3fa83ef9eac8a43dde6d9a7524951480` (old main, закреплённый baseline). В релиз входят ровно три одобренных изменения:

1. `universal-work-shares` (`614ec23`) — универсальное распределение количества работы между задачами.
2. `manager-cash-advances` (`3f6da0d`) — выдача менеджером авансов из кассы с учётом баланса.
3. `product-hero-images` (`c3c58a0`) — отображение главных изображений изделий.

Изменения `percentagepay` (`080d`) и `oldengineeringfund` (`9b69`), а также `coverreplace/optimization` (`a899`) исключены. Не включать их зависимости, миграции или поведение при выборочном переносе.

Владелец явно одобрил выпуск именно этого набора 01.10.2026; это снимает прежнюю production-HOLD формулировку только для этих трёх функций. Локальные проверки завершены; root ожидает выполнить push кандидата в main. GitHub CI запускает test gate на main, прошедший gate публикует образ для штатного watcher. Проверку production результата владелец принял на себя. Production SQL/SSH/result checks агентом не выполняются.

Root создал и опубликовал annotated Git tag `codex/pre-crm-three-features-20261001` на old-main ревизии `2cac6f3c3fa83ef9eac8a43dde6d9a7524951480`. Это только source checkpoint, не backup базы/хранилища и не подтверждение текущего production image. Root сообщил, что `apps/web/src` и Prisma schema в old main совпадают с ранее принятым production-functional source baseline `a1123c5`, а отличия только в docs/QA tooling; текущий сервер не читали и не проверяли.

В кандидате ровно две новые аддитивные миграции: `20260928140000_universal_work_shares` (SHA-256 `65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6`) и `20260929120000_manager_cash_advances` (SHA-256 `bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd`). Для hero images миграции нет. Root подтвердил отсутствие изменений в `projects/core.ts`, workflow и file API; в `src`/Prisma schema не найдено ссылок на исключённые процентный фонд, percentage-pay или cover mutation.

В release-ветке находятся selective backports: `universal-work-shares` импортирован как `608b3f7`, `manager-cash-advances` закоммичен как `373c54d`, `product-hero-images` закоммичен как `3f9780c`. Дополнительно commit `a69` исправляет только CI-тестовую гонку в `deploy/tests/test_watch_crm.py`; watcher, workflow и runtime не менялись. Receipts исходных feature-веток раздельные: shares `614ec23128de83f16833a56443354c2707e87c60` и cash `3f6da0da082cc707370346c9c3a458ba24d1c189` прошли первоначальную local/staging-приёмку. Исходный `product-hero-images` (`c3c58a09622927abacbf0805e744cea5e377e981`) также завершил локальную и read-only staging-приёмку, зафиксированную к `b91dcfa`: **499/499** app tests, lint/build/typecheck, строгая OpenSpec-валидация и CUA на 360/390/1440; публичный staging receipt указан в `verification.md`. Эти исходные приёмки остаются отдельными от backport-кандидата.

## Порядок выпуска

1. Root сверил diff относительно baseline, оставив только три функции и необходимые изменения.
2. Root завершил локальные проверки кандидата (см. результаты ниже).
3. На момент этого pre-push снимка main push ожидает root. Feature-branch push сам по себе CI не запускает; после push GitHub main CI выполняет test gate, только успешный gate публикует образ, затем штатный watcher выполняет deploy. Подтверждением фактической доставки служат Git `main` ref и итоговый receipt.
4. Владелец явно принял production result acceptance. Проверки production выполняет владелец; агентом production SQL, SSH, QA, restart или result checks не выполняются.

## Откат и совместимость данных

До создания новых записей распределения работ и кассовых авансов допустимо вернуть приложение на старый код, сохранив обе аддитивные миграции в базе: данные ещё не зависят от новой семантики.

После появления таких записей старый код нельзя считать безопасным: он может неверно рассчитать распределённые доли и завысить доступный остаток кассы, поскольку не учитывает новые записи/правила. В этом состоянии оставлять совместимые чтение и расчёт распределений и авансов. Если потребуется остановить новые операции, подготовить совместимый forward-fix, отключающий запись, либо исправление вперёд; feature flag сейчас не заявлен как реализованный. Возврат старого приложения допустим только после подтверждённого способа сохранить правильные чтение и расчёты.

Не выполнять слепой откат, удаление данных или downgrade/drop миграций. Этот план не обещает безопасный откат всей базы данных и не утверждает, что такой откат выполнен. После миграции сохранять данные и выбирать совместимый код или forward-fix.

## Фактические проверки

- Исходные local/staging receipts для `universal-work-shares` и `manager-cash-advances`: PASS; см. разделы OpenSpec с provenance.
- Исходные local/staging checks для `product-hero-images`: 499/499 app tests, lint/build/typecheck, strict OpenSpec validation, local CUA и qualified read-only staging CUA PASS согласно `verification.md` и публичному receipt; это не проверка нового backport-кандидата.
- Release-кандидат: `pnpm-rtests` web **219/219 PASS**, bot **9/9 PASS**; Python deploy unittest **39 всего** (37 пройдено, 2 Windows POSIX-only skip); lint — 0 ошибок и 1 прежнее предупреждение `existsSync` в `scripts/cleanup-uploads.ts`; Next production build PASS с фиктивным DSN (без живой БД); post-build web TypeScript, bot TypeScript и Prisma validate PASS; `openspec validate --all --strict` **8/8 PASS**; `git diff --check` PASS.
- Прицельная проверка состава подтвердила ровно две новые миграции с указанными SHA, отсутствие исключённых fund/percentage/cover изменений в `src`/schema, а также неизменность `projects/core.ts`, workflow и file API.
- Локальные проверки релизного кандидата завершены. Main CI не запускался: push в main ожидается от root. Production rollout/result checks не выполнялись агентом; владелец явно принимает production-проверку после штатного deploy.
