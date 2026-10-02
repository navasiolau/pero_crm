# Tasks

## 1. База после staging17

- [x] 1.1 Оркестратор разрешил независимую local implementation после локальной приёмки кода №17 и создал feature/18 от fresh origin/staging6edd76ef2cee0b7ce40c5df4399ea9b7570b0728. Official CLI root/context/status/strict validation сверены; чужие изменения сохранены. Интеграция №18 в staging gated фактической финальной приёмкой №17.
- [x] 1.2 Зафиксировать точные accepted17 seams: inline-save-controller/hooks/fields, Project/Client contact helpers, legacy baselines и stage callers web/API/бот/kanban; подтвердить карту одних операций без альтернативных writers.

## 2. ProjectPatch и совместимость

- [x] 2.1 RED→GREEN closed ProjectPatch/result схемы (field/value/expectedValue/UUID), decimal strings/null/zero, required name/phone, запрет currency/initialPrice/служебных дат и вычисляемых полей; tests доказывают валидацию до writes и сериализацию DTO.
- [x] 2.2 Обобщить shared contact primitive №17 на projectId и сохранить product wrapper; tests двух изделий/проекта без изделий, old phone client-binding conflict с authorized explicit rebase context, MANAGER union и запрет hidden DTO readonly ролям.
- [x] 2.3 Реализовать CAS/receipt для project fields и transactional audit/outbox; RED→GREEN same/different-field конкуренция, no-op/no audit, replay/id-payload reuse, rollback после audit/outbox failure.
- [x] 2.4 Защитить полноценный legacy full update и bot/API genuine baseline для каждого обычного поля, onlychanged writes; regression test old title/address/manager/services form vs parallel inline и missing-baseline отказ, без server baseline substitution. Обычный bot field PATCH использует тот же closed ProjectPatch/URI binding/UUID receipt для lost-ACK retry, legacyfull path сохраняется.
- [x] 2.5 Вернуть лёгкий expected total после service суммы существующим Decimal helper/minimal product prices+quantity select; tests null/zero/quantity и source/query profile показывают отсутствие Payment/payroll/history/files/FX чтения и immutable snapshots; service write при null product price сохраняется с null subtotal/total, версии txid_current() защищают от поздних monetary ACK, подтверждённые peer baselines не подменяются.

Локальный domain evidence: исходный project field RED — 5 тестов, 4 failures; после реализации 26/26 целевых domain/action/legacy/currency checks и 2/2 light-card query checks прошли. Web/бот typecheck и targeted ESLint прошли. Runtime, полная browser/CI/staging-приёмка этим evidence не подтверждаются.

## 3. Профильный статус

- [x] 3.1 Зафиксировать RED текущего core: REFUSED без reason, RECLAMATION без reason/description/fault сейчас не защищены; внедрить единый new extras validation, expectedStage и receipt внутри stage transaction. GREEN доказывает refusalComment optional, no-op/replay и отсутствие product pay accrual.
- [x] 3.2 Перевести select/kanban/actions/API/бот на один status contract с настоящим captured expectedStage; tests двух competing transitions, stale/missing baseline, роли и отказ до statusChangedAt/history/audit/outbox writes.
- [x] 3.3 Подключить общий extras dialog и queue/barrier: cancel/failure/conflict сохраняют draft и откатывают visual drag/select, dirty finance/contact flush до status POST. Browser доказывает отсутствие предварительной stage записи и комментарий отказа не обязателен.

## 4. Project UI и файлы

- [x] 4.1 Переиспользовать №17 hook/fields и compact action без revalidatePath/tag/router.refresh; browser keyboard/blur/select/no-op/slow/fail/replay/CAS сохраняет ввод; reuse независимого registered Server Action transport №17 с same-origin project-only URL и pinned installed Flight codec проходит unit+compiled neighbor-ACK проверки. Сеть и SELECT profile подтверждают отсутствие полного card Flight/economics/history.
- [x] 4.2 Установить titlefirst/Статус, exact grey readonly engineer label+unique visible product assignments, hide project initialPrice; проверить role DOM/DTO, snapshots unchanged и не создавать новый Project engineer writer.
- [x] 4.3 Вкладки Общее→Изделия→Файлы→Задачи→Материалы→Финансы с role gates; убрать communication/history UI и ненужные card queries, сохранив данные/admin Changelog/plugin tabs. Browser проверяет порядок, роли и saved preference fallback от удалённой вкладки к Общее.
- [x] 4.4 Flat project files без grouping, preserve stored categories/stages/ACL/FileViewer/download/ConfirmDelete; tests/browse прямых оригиналов/превью, append двух PDF, точное удаление ID и отсутствие extraction/financial effects/утраты dirty drafts.

## 5. Проверка и staging

- [x] 5.1 Targeted/full tests, lint/typecheck/build и diff проходят; evidence содержит RED→GREEN и отсутствие dependencies/schema/data migration, initialPrice автоматики и несвязанных numbered задач.
- [x] 5.2 Лично проверить local браузер для manager/ADMIN/MANAGER+ENGINEER/ENGINEER/ACCOUNTANT и запрещённых field roles, two-user/contact/status races; screenshots/network/SELECT evidence отдельно от build, state hashes/restore по разрешённому runtime контуру без дампов.
- [x] 5.3 Размеры 320×800,360×800,390×844,768×1024,1024×768,1440×900, sidebar/actual200% browser zoom: нет page overflow, формы/errors/files доступны; недоступные проверки не считать выполненными.
- [x] 5.4 После приёмки №17 выполнены commit и обычный merge №18; фактически развёрнутая staging-ревизия 24bdc21494a57877b23f64c803152b619146b360 принята: native7, browser76, actualChrome200zoom5, реальные файлы/API/роли и exact cleanup PASS. Web и staging-bot healthy на этом SHA; W07/DB сохранены. CI logs недоступны, публикация образов gated needs:test. Main/production вне объёма.
