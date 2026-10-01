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

## Следующая проверка

Интеграция в staging и приёмка новой фактической staging revision выполняются далее. Эти результаты пока не заявлены; прежний полный live QA остаётся evidence исходной идентичной app-ревизии 987787f.
