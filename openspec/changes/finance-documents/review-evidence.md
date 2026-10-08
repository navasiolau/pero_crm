# Уточнение интерфейса №97 — 08.10.2026

Повторная работа в исходной feature/97 после fast-forward свежего staging e6d67d6; другая новая задача не создаётся. Владелец убрал самостоятельный экран документов и запросил просмотр из операций. Необязательное прикрепление при оплаченной закупке — отдельная доработка №103.

## Local

- Самостоятельный documents-view удалён, плитка убрана. Прежний /finance/documents после проверки финансовых прав перенаправляет к расходам; upload/read API и FinanceDocument/Payment сохраняются.
- Общая ReportDocumentButton в desktop/mobile расходах и движениях, только при наличии файла. Складская строка получает тот же reportDocument через StockPurchase.payment одним пакетным запросом, только для финансовых ролей. Пустые/PENDING документы и metadata для MANAGER отсутствуют.
- Общий FileViewer поддерживает явный fullscreen: фото/защищённый PDF и скачивание неподдерживаемого формата. Технические обычные PDF по-прежнему открываются прежним способом. Мобильное правило едино для всех fullscreen-вариантов, всплытие клика кнопки остановлено.
- RED→GREEN3 новых проверок, focused25 и fullweb1362/1362 PASS; types/lint/build PASS, 5 прежних lint warnings. Strict OpenSpec PASS. Новой миграции нет.
- Реальный PostgreSQL: одна ссылка документа в Payment/складской проекции, inventory/old expense/PENDING без кнопки, manager скрыт, совмещённая финансовая роль разрешена. Весь native rollback, исходные digest MATCH.
- Реальные local HTTP: upload/retry/старый redirect/плитка/expense+warehouse SSR/inline PDF bytes/финансовые права PASS. Точные собственные строки и bytes удалены, digest MATCH, providerMessages0.
- Настоящий локальный браузер/production CSS: файл загружен из формы расхода; фото и валидный PDF открыты из обеих строк, fullscreen1440/390, без второго окна и случайного открытия расхода. Inventory и manager без кнопки. Визуальные screenshots проверены. Для PDF использован полный Chromium (channel chromium): упрощённый headless shell не отображал встроенный PDF renderer. CSP sandbox/private headers не ослаблены.

## Staging

Обычный merge 491685b31ac274b771c58655a2644d88713ffce9, CI176 SUCCESS. На фактически работающем staging подтверждены revision, healthy и image sha256:140ed40274fb9ddcb266f56584efda5051d2ed33e0f44f8e48caae42b3b3149c.

Native + HTTP + S3 PASS: один документ у расхода и движения, отсутствие данных кнопки для пустых/PENDING, объединение финансовых ролей без утечки менеджеру, прежний URL перенаправляет, плитки нет, настоящий PDF возвращается inline с совпадающими bytes. Собственные QA-строки/объекты удалены, исходные digest MATCH, providerMessages0. DB container/start/volume и W07 hash совпали с baseline, refresh не выполнялся. Receipt: ignored .playwright-mcp/finance97-review/staging-receipt.json, bundle SHA256 9cd3d463b38f270bf4b061c208bda42bf3c09267f8bb1b653ee4532dfec3e216.

Разовое исправление production-движения по отдельному прямому поручению владельца выполнено независимо; этот change не выпускается в main.
