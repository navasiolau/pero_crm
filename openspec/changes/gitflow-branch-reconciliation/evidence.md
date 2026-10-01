# Evidence — задача 1

## Граница выпуска

Владелец назначил номер 1 после предложения согласования. Рабочая ветка `bugfix/1` создана от origin/staging `987787fbcba9dc17bd72113e882d4732cc4d17d0` в отдельном managed worktree. Main push и production-миграция не разрешены и не выполняются.

## Согласование main

- Выполнен обычный merge origin/main `7c51972d4264bd10fb779638cc94c13d6533d6b7`, с сохранением обоих родителей. Разрешены 8 app-конфликтов вариантом проверенного staging и 14 OpenSpec конфликтов актуальными документами main.
- Полное дерево приложения совпадает с принятой staging ревизией; пакеты, lockfile, workflow, runtime watcher и compose тоже идентичны. Нового кода приложения и миграций этого change нет.
- Сохранены все 22 документа, которыми main отличался от базы количества a899e8e. В импортированной CRM_IMPROVEMENTS_PLAN.md отдельно изменено только устаревшее правило codex/… на ссылку на GitFlow в AGENTS.md.
- Исходный незакоммиченный CRM_IMPROVEMENTS_PLAN.md в D:/Projects/pero_crm_v2 сохранён: SHA256 `1c92526a72a0f6b00c67fef91f8f65b83e07a53bea75feef30c25256f95d22b8`.
- AGENTS.md задаёт обязательный процесс для feature/bugfix/hotfix, одну маленькую задачу/OpenSpec change, содержательные коммиты, local → staging → main и одинаковый SHA после выпуска. Новая бизнес-спецификация не требуется; skip_specs объявлен явно.

## Локальные проверки кандидата

- pnpm install --frozen-lockfile --prefer-offline — PASS, lockfile не изменён.
- pnpm -r --if-present test — web 544/544, bot 9/9 PASS.
- Python deploy unittest — 66 всего, 64 PASS / 2 прежних Windows skip.
- Web/bot TypeScript — PASS; ESLint 0 ошибок / 1 прежнее предупреждение existsSync в cleanup-uploads.ts.
- Next production build — PASS с фиктивным DATABASE_URL на loopback-порту 9; к реальной БД сборка не подключалась. Post-build web TypeScript и Prisma validate — PASS.
- OpenSpec --all --strict — 13/13 PASS; git diff --cached --check — PASS.

## Итоговые QA/evidence количества

Обычным merge включён product-quantity 62415eb: четыре ранее подготовленных QA/evidence файла; приложение осталось побайтно равным принятому staging 987787f. Новых тестовых данных или бизнес-операций нет.

## Staging-приёмка согласованной истории

- bugfix/1 опубликована; обычный merge рабочей ветки в staging создал 530df25c6971107a6ffb283da62fb95db40f0359. Оба прежних main/staging и исходная ветка product-quantity входят в ancestry; main теперь можно продвинуть fast-forward без конфликтов.
- CI-публикация CRM образа подтверждена чтением GHCR: sha256:24c555c888dd3dfe95edd4b35dd3e5aba427c2ad4b36fb88970564d68f35f583. Workflow needs:test сохраняется; полная Actions-run conclusion отдельным API не доступна и не заявлена.
- Реально работает healthy web e2dc3bee974ae8aea66b6b62e7a8b4abfcf469164e930eec2140026ccd4b4cc4 на revision 530df25, старт 01.10.2026 13:20:07 UTC. Штатный watcher/W07 выполнил доставку; root не менял deploy/refresh конфигурацию.
- Предыдущие DB ID/start/volume и W07 SHA подтверждены свежим guard. Production не подключалась и не изменялась.
- Публичный HTTPS с Basic Auth, краткоживущая проверенная сессия существующего MANAGER: карточка изделия, проект и задачи на 360/390/1440 — 9/9 HTTP200, pageErrors []. Нормальный service worker разрешён; запись блокируется, отдельно разрешён только source-verified getBellData без аргументов. Новых QA-записей нет.
- После просмотра read-only сверка подтвердила неизменность 13 business tables, ChangeLog/TimeEntry и 4 исходных ключей UserPreference. Куки/секреты обрабатывались только в памяти; read-only транзакции и исходный guard сохранены.
- Root просмотрел product390/project360 и отдельный viewport tasks1440; дополнительная точечная проверка задач 1/1, без ошибок, с той же сверкой сохранности. Полный снимок задач оказался очень высоким, поэтому desktop просмотрен по новому viewport capture.
- Ошибки первых попыток были в контуре: импорт support без регистрации Python module, неоднозначный locator main и блокировка service worker (9 waiting errors). Исправлен только локальный/remote QA transport, app tree не менялся. Первая полная попытка также подтвердила сохранность; конечный нормальный browser run ошибок не имеет.
- [Публичный receipt](staging-smoke-20261001.json). Прежний полный live product-quantity QA остаётся evidence идентичной app-ревизии 987787f; новые операции партии этому read-only smoke не приписываются.

## Ожидает прямого решения владельца

Main остаётся 7c51972d4264bd10fb779638cc94c13d6533d6b7. До одинаковых main/staging осталось разрешение выпуска и конкретной миграции 20261001120000_product_quantity с production-проверками и одним временным дампом только перед миграцией (без restic), затем fast-forward и проверка фактического production deployment. Эти задачи не отмечены выполненными. Итоговый acceptance отчёт пока записан локально в bugfix/1; после разрешения выпуска он будет включён через тот же staging pipeline без изменений приложения.

## Уточнение владельца о дампах — 01.10.2026

Restic полностью исключён из прикладных задач; local/staging дампы запрещены, в том числе перед миграциями. Для production только при миграции нужен один временный дамп с проверкой восстановления; после успешной проверки выпуска и ненужности файл удаляется по точному пути. Правило внесено в AGENTS.md и текущие proposal/design/tasks. Исторические приёмки прежних запусков сохраняются как факты прошлого. В этом уточнении restic не запускался, дампы не создавались и не удалялись.
