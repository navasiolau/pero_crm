# Приёмка №198 — 29.10.2026

База ветки: origin/staging 0045d3698cee2074e805abe56f817d2d6238d180. Владелец разрешил коммит и последовательную доставку в staging после №197. CI №197 заблокирован отдельным вопросом runtime image identity; исправление согласовано как №199.

## Local

- RED: прямое чтение возвращало удалённый рейс, upload публиковал его документ. Два содержательных отказа получены до реализации.
- GREEN:14/14 logistics-soft-delete/trips/cash-allocation/workspace-render. TypeScript, целевой ESLint, diff check и strict OpenSpec PASS.
- На существующем pero_crm_pg (точный ID bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5, loopback5433/pero_crm) применены только две новые миграции №198. Вторая расширяет CHECK операции receipt, обнаруженный реальным SQL; первая применённая миграция и история не переписаны. Дампов/reset/seed нет.
- Native PASS отдельно для BYN и USD с курсом3: оплаченный рейс40/60, исправление10→12, точный возврат кассового/организационного остатка, нулевой факт доставки и расходы экономики проекта, правильное closing кассового отчёта. Payment/Posting/Allocation/документы/состав остаются побайтово прежними; чужой рейс сохраняется.
- Проверены все роли кроме ADMIN, отключённый ADMIN, отзыв ADMIN после trip lock, stale revision, тот же UUID без writes, другой payload UUID, rollback при ошибке финального ChangeLog. Проверены запреты чтения/редактирования/нового проведения/старого адреса ТТН. Удаление между reserve/finalize upload оставляет PENDING и не публикует документ.
- Все собственные данные отменены outer rollback; полный nativeSnapshot таблиц/ограничений/триггеров/функций/индексов совпал. Storage injected; реальный S3 upload этим не подтверждается.
- Chromium с реальными Workspace/DeleteButton/ConfirmDeleteDialog, globals.css и Roboto:1440×900,390×844,360×800. Отмена без action, подтверждение денег40/60, два повтора после потерянного ответа с одинаковым payload/UUID, ровно один refresh, отсутствие всплытия клика в строку, отсутствие кнопки у DIRECTOR/PROCUREMENT, без overflow/page errors. Server action injected; это component runtime, не полный E2E удаления через Next. Приватные receipt/PNG в `.playwright-mcp/logistics/` worktree logistics-198.

## Pending

- Реальный CI-тест двух PostgreSQL backend: delete/post обоих порядков, наблюдение ожидания общего advisory lock и отказ устаревшего проигравшего — PASS в PostgreSQL-фазе CI340. Пункт1.3 закрыт по фактическому результату.
- Интеграция, CI и фактический staging после приёмки №197/№199 — NOT_RUN.
- Production release/миграции/soft delete указанного UUID — NOT_RUN. Разрешение удалить эту запись уже дано; перед действием требуется повторный exact allowlist guard.

## Интеграция с принятым staging e9b8eb09

После успешной фактической приёмки №197/199 выполнен обычный merge принятого staging в feature/198. Конфликты в общих form/query/core/tests разрешены сохранением обеих функций: ttnNotRequired и deletedAt/canDelete. Объединённые целевые тесты17/17, typecheck/lint, native №197 и BYN/USD удаления, browser component PASS. Дополнительно включён native сценарий удаления оплаченного рейса с ttnNotRequired=true и без документов. Перед staging выполняется его отдельная проверка. Production не менялся.

CI340/848b3b45 выявил одно прежнее DI-ожидание cash-balance-valuation: оно проверяло точную форму activePaymentWhere без нового trip.deletedAt=null. Ожидание обновлено с сохранением требования read-only consistent snapshot и ACTIVE; само денежное чтение не ослаблялось. Публикация при этом отказе не выполнялась.

После исправления ожидания58/58 целевых финансовых tests PASS. В CI340 PostgreSQL83/83 и HTTP32/32 PASS, guards13/13; soft-delete native (BYN/USD/безТТН) и delete-versus-post real lock PASS. Native job отказал позже только на обязательной проверке успешного backend producer; общий CI340 остаётся FAILED и не считается успешной доставкой. Следующий CI должен целиком пройти до публикации.

## Фактический staging — принят 1cc96c58

- [CI341](https://github.com/navasiolau/pero_crm/actions/runs/40791216788):7/7 jobs SUCCESS. Принят точный SHA1cc96c586cae7bceae2092e4508b58eab61423f6; web OCI index305ad67dc19326202787b18b1e54768556cc4c05df670f2cd03456cb9423287a и renderer index5490cb86ae8dd03326a3600503dfd7076611421de239db76e15c090e473db09d совпали с CI, оба healthy.
- DB27b8f734.../started2026-09-23T11:42:14.649193151Z/том crm-staging_pgdata и W07 SHA27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139 сохранены. После двух миграций №198 изменился только _prisma_migrations; fingerprints прочих таблиц совпали с проекцией штатного внешнего ApiToken.lastUsedAt, остальные поля и число токенов проверяются.
- Actual native на существующем staging: регрессия №197, delete BYN, delete USD, delete paid-without-TTN — каждый PASS с полным outer rollback. Проверены live ADMIN/revoke-after-lock, stale/replay/audit fault, касса/организация/бюджет/экономика/кассовый отчёт, неизменная денежная история и чужой рейс, guards docs/read/update/post и upload phase race.
- Первый общий native превысил110s; транзакция отменена, fingerprints всех77таблиц после него совпали. Прогон разделён на четыре коротких сценария; пределы110s transaction/135s wrapper и W07 не увеличивались.
- Actual HTTPS browser: ADMIN1440×900/390×844/360×800, DIRECTOR/PROCUREMENT/ACCOUNTANT390×844. Галочка сохраняет UI-поведение; delete только ADMIN, подтверждение с фактическими400BYN исходного staging рейса. Два нажатия после заблокированного HTTP-ответа дают один и тот же payload/UUID, корректный revision и точный tripId. Отмена работает; чужой рейс не удалялся — все POST намеренно блокировались, native отдельно исполнял реальные SQL writes с rollback. Page errors0, PNG лично просмотрены.
- Приватные receipts: `.playwright-mcp/logistics/stage-native198-*.receipt.private.json`, `staging-browser198.json`, `staging198-screenshots/` worktree logistics-197. Все четыре сценария связаны с1cc96c58 и точными Docker/DB/W07 identities. Production не менялся.
- Перед production в №197 дополнительно исправлена совместимость старых fingerprints; приёмка затронутых повторов проводится на следующем SHA. Приёмка удаления1cc96c58 не подменяет эту дополнительную проверку.
