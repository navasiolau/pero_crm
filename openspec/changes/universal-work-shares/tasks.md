# Tasks

## 1. Контракт и точная арифметика

- [x] 1.1 Подготовить additive schema/migration без её выполнения, проверить генерацию отдельного Prisma Client и отсутствие изменения старых начислений в SQL.
- [x] 1.2 Зафиксировать числовой RED для бюджета/повторного деления/копейки/нулевой задачи и учёта количества группы один раз; реализовать общую арифметику до GREEN.

## 2. Серверное деление и конкурентность

- [x] 2.1 Добавить DI RED/GREEN для прав всех ролей, ограничений инженера, DONE/начислений, неактивного получателя, старой ревизии и повторного UUID; реализовать транзакционный split.
- [x] 2.2 Согласовать create/update/delete/status и удаление Work через транзакционный доменный lock; DI-тестами проверить одновременные split/complete, однократное начисление, rollback и точные суммы.
- [x] 2.3 Сохранять факт/файлы на исходной задаче, копировать предшественников и расширять dependents на группу; DI-тесты подтверждают ожидание обеих частей и недопустимость разрушения группы редактированием/удалением.

## 3. Интерфейс и локальные проверки без БД

- [x] 3.1 Добавить доли/суммы/права в TaskDetails, общий мобильный split-диалог и кнопки в TaskDialog/MyTasksView; проверить UI-контракт unit/статически и типизацию всех callsites.
- [x] 3.2 Выполнить полный unit/DI набор, typecheck/lint/build без БД, OpenSpec validate; записать результаты RED/GREEN и передать diff на независимый root review.

## 4. Приёмка после отдельного разрешения

- [x] 4.1 Выполнить разрешённую локальную миграцию, native DB concurrency и браузерную приёмку на выделенных локальных данных; receipts приложены.
- [x] 4.2 Сформировать feature-коммит, пройти CI и staging rollout/browser acceptance точной ревизии; receipts приложены. Эта приёмка относится к исходной реализации `614ec23128de83f16833a56443354c2707e87c60`, а не к текущему выборочному release-branch backport.
- [ ] 4.3 Владелец 01.10.2026 одобрил main-релиз ровно трёх согласованных функций, снимая прежний HOLD для этого набора. Локальные проверки release-кандидата завершены root (результаты ниже); main push остаётся ожидающим. GitHub CI запускается для main, тестовый gate публикует образ, штатный watcher выполняет deploy. Production acceptance явно делегирован владельцу; production SQL/SSH/result checks агентом не выполняются.

### Локальная приёмка selective release-кандидата

Root сообщил: web `pnpm-rtests` **219/219 PASS**, bot **9/9 PASS**, Python deploy unittest **39 всего** (37 PASS, 2 Windows POSIX-only skip), lint 0 ошибок и 1 прежнее предупреждение `existsSync`, Next production build PASS на фиктивном DSN без live DB, post-build web/bot TypeScript и Prisma validate PASS, `openspec validate --all --strict` **8/8 PASS**, `git diff --check` PASS. Подтверждено ровно две новые аддитивные миграции: `20260928140000_universal_work_shares` SHA-256 `65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6`; `20260929120000_manager_cash_advances` SHA-256 `bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd`. Исключённые fund/percentage/cover изменения в `src`/schema не найдены; `projects/core.ts`, workflow и file API без изменений. Это локальные проверки release-кандидата; нового staging или production acceptance не выполняли.
