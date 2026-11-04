# Проверка №211 — 04.11.2026

## Состояние

- Worktree `D:/Projects/pero_crm_worktrees/product-numbering-211`, ветка `bugfix/211`, база — свежий `origin/staging` `38899d645ff3cd279eb68743d7d52d18a16d8229` после fetch.
- Реализация и локальная приёмка завершены. Владелец 04.11.2026 разрешил commit, staging/main и выпуск на production, отдельно поручив заблаговременный дамп. На момент code commit эти действия ещё **NOT_RUN**; фактические receipts последующих этапов добавляются по результатам.
- Миграций, seed/reset существующих данных и действий с restic/S3 нет. По новому отдельному поручению владельца перед production создаётся один дамп с изолированной проверкой восстановления. Owner-документы исходного worktree сохранены.

## Подтверждённое поведение

- Только неудалённые Product-строки одного живого проекта, все статусы и роли, независимо от quantity. Порядок suffixInt/createdAt/id, атомарная нормализация, аудит, стабильные ID и внутренние Notification.link.
- Удаление 7-го из 15 сохраняет 1…6 и сдвигает прежние 8…15 к 7…14. Повтор не сдвигает снова, следующее создание получает 15. Первый/последний/единственный, пустой состав, высокие удалённые номера, пропуски/равные/null-суффиксы проверены.
- Ошибка аудита откатывает скрытие и все сдвиги. Real PostgreSQL unique-ошибка audit подтверждена savepoint/rollback с сохранением исходных строк.
- Синхронизация КП задаёт собственный порядок полного снимка; вложенное создание не нормализует промежуточный состав. Проверены перестановка, новые/исключённые/восстановленные позиции, количество, роли и сохранность финансовой истории.

## Локальные результаты

| Проверка | Результат | Evidence |
|---|---|---|
| Содержательный RED | PASS: прежний код выдавал 1.64 вместо 1.15, .100 вместо .1 и .10 вместо .4 | `.playwright-mcp/task-211/red.log` |
| Целевые unit/action/KP проверки | PASS; 32 проверки с kanban browser и 13 с fault injection post-commit | `targeted-final.log`, `targeted-actions.log` |
| Полный web suite | **1389/1389 PASS**, 0 skipped, `tsx --test --test-concurrency=4 tests/*.test.ts tests/*.test.mjs` | `web-tests-bounded.log` |
| TypeScript strict | PASS, `tsc --noEmit --incremental false` | `types-final.log` |
| Lint | PASS, 0 ошибок; 4 прежних warning в незатронутых файлах | `lint-final.log` |
| Production build | PASS, Next.js production build | `build.log` |
| OpenSpec | PASS, `openspec validate product-sequential-numbering --strict` | CLI output |
| Native local5433 | PASS: номера, 3 ссылки с query/hash, начисление/задача/история, SQL audit rollback, apply/replay/rollback/stale/occupied | `local-native-final.log` |
| Две PostgreSQL-сессии | PASS: одновременные create/delete, 2 различных backend PID, итог 15 последовательных действующих изделий | `browser-fixture.ts race`, tool output и приватная QA fixture |
| Browser/UI | PASS: настоящий credentials login, delete 7/15, карточка следующего изделия по прежнему ID с новым номером 7, создание после 14 даёт 15, global search и alias HTTP 200 | скриншоты и MCP transcript |
| Negative target guard | PASS: локальный запуск production bundle отклонён до подключения | `negative-target.log` |
| Python dispatcher syntax | PASS, `py_compile` обоих файлов | CLI output |
| Diff review | PASS: транзакционность, роли, выдача/повтор ACK, before/after aliases, публичные параметры, отсутствие миграций/чужих файлов; `git diff --check` PASS | проверенный diff |

Первые два полных запуска с неограниченным параллелизмом дали по одному разному browser-сбою: DnD highlight и download timeout. Одиночные запуски kanban на исходном main и ветке прошли. Полный тот же набор с четырьмя процессами прошёл без исключения тестов; package scripts и CI workflow не менялись.

Native-проверки выполнялись на существующем `pero_crm_pg`, container ID `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, только 127.0.0.1:5433/pero_crm, роль pero. Rollback-транзакции и последующий cleanup собственных QA211-строк подтвердили полное совпадение исходных fingerprints всех таблиц. Новая БД или стенд не создавались.

После QA собственный Next.js на 32011 остановлен, одноразовый локальный bridge завершён, QA browser tab закрыт. Контейнер БД, исходно остановленный, возвращён в `Running=false`, `Status=exited`; других запущенных локальных контейнеров нет. Исходный main worktree сохранил только два прежних owner untracked-документа без изменений.

Лично просмотрены 1440×900, 390×844 и 360×800. Скриншоты: `D:/Projects/pero_crm_v2/.playwright-mcp/task-211-numbering/`. В браузере создание из проекта штатно оставляет пользователя на вкладке изделий с уведомлением; новый номер 206.15 проверен в канбане, поиске и карточке.

## Production: факт и отдельное решение владельца

1. Исходный check на production SHA `38899d645ff3cd279eb68743d7d52d18a16d8229` остановился без записи: предположение о составе 1.1–1.14 было неверным. Результат сохранён в `production-check.private.json`.
2. После отдельного разрешения владельца выполнена диагностическая транзакция `READ ONLY`, только ID/number/suffixInt. Проект ID `1`, действующих изделий 15, удалённых 0. Номера: **1.2–1.5, 1.7–1.12, 1.14, 1.61–1.64**. Причина выдачи 64 — прежний действующий максимум 63; объяснение удалённой историей для этого проекта не подтвердилось.
3. Владельцу показана таблица полной нормализации; он явно выбрал **«Только 1.64 → 1.15»**. Сохранение остальных 14 текущих номеров и пропусков — принятое ограничение одноразовой коррекции.
4. CLI привязан к этому исходному составу и Product ID **cmw1xgkk8001opd01mal0r7ad**. Обновлённый check PASS, 15 действующих строк, действующий 1.15 свободен. Guards host/compose/image/db/network/storage прошли; приватный baseline — `production-check-approved.private.json`.
5. Production **не изменён**. После принятого deployment нужен новый check на новом полном SHA; старый baseline не принимается dispatcher при другом deployment SHA. Затем допустимо изменить только number/suffixInt/updatedAt выбранной Product-строки, сохранить ссылки по ID и audit/receipt, проверить неизменность остальных 14 строк и защищённых данных. Подготовлены guard-проверяемый повтор и обратная операция.

Полную непрерывность текущего production-состава после этой одной правки не заявлять. Последующие обычные create/delete используют согласованный общий алгоритм 1…N для затронутого проекта. Руководство: `apps/web/scripts/product-number-repair/README.md`.
