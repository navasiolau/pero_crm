# Round2 CRM: проектная приёмка от 02.10.2026

## Статус

Реализация app-задач39–45 завершена локально. Root подтвердил source parity между compiled local6b22 и pushed `a160b5bdf9ebbbec1fd06248bc0026e073cf12c5`: последующие различия только в scripts/tests/docs. CI93 завершён успешно, новый staging образ здоров. Финальная hosted browser приёмка ещё выполняется. Mainf036 остаётся прежним, выпуск в production не разрешён.

## Локальные проверки

Полный web suite: 952/952 PASS, fail0/skip0. После предыдущего результата исправлен только тест, ожидавший уже удалённую SSR-компоновку. Полный TypeScript PASS.

Native42 actual local: 5 групп PASS, all43-table outer rollback verified, externalFetch0. Проверены менеджмент/CAS/replay, NULL и 0, один snapshot трёх default rates при создании, отсутствие изменений старых изделий/финансов. Private receipt: `correction-41/.playwright-mcp/round2/local-defaults-native.private.json`. Actual local browser8bdf3fd1 прошёл62 checks, 7 файлов, protocolStopped=false, CLEANED/original MATCH/prefs RESTORED26 (25 unchanged,1 restored). Предыдущие1aee FAIL48 и30ac FAIL52 сохранены с успешным cleanup: исправлены только helper Node и выбор вкладки для readonly contacts. Assertions и app source не менялись. Staging native42 прошёл5 групп/all43 rollback/externalFetch0 на actual a160; stage browser ещё выполняется.

## Подтверждённый deployment

CI93 SUCCESS run37063222232: test4m6/build3m29/bot1m12. Actual staging a160 healthy, image `e01c37d1b51604257d5baec6022cd8d6ce2742223a325ae41a0361dfedef1dc7`. Root сохранил evidence44-delivered-metadata и staging-defaults-native; native42 actual5groups/all43 rollback/externalFetch0 PASS. Эти факты не заменяют ожидаемый stage browser result.

## №46: данные тестовых окружений

Root применил V3 на actual staging02d7/image14f: 10 проектов и20 изделий в точной области плана; all-other DATA MATCH. Post-readonly: staging184BYN, foreign0. Local174BYN, foreign0. Повтор того же плана дал ALREADY_APPLIED, committedFALSE, MATCH10/20: повторных business writes нет.

Первоначальные STOP сохранены. TS CLI остановился до DB и заменён ESM builder. Raw pg_advisory void остановился до writes и исправлен SELECT1. Два original-fingerprint stale результата вызваны operational `ApiToken.lastUsedAt`. Подписанный V2 profile исключает только этот timestamp и отвергает старые manifests; финансовые таблицы и другие поля остаются строго защищёнными. Ни triggers, backup/reset, migration, ни production DB не использовались.

Эта проверка данных не заменяет приёмку новой APP revision a160.

## №32: единственный отчёт по production app

Production источник получен обычным read-only Collector через приложение: полный список191, валютных проектов10, недоступных details0. Business POST и direct production DB не выполнялись.

Создан один `NON_BYN_PROJECT_PRICES.xlsx`: 10 проектов, 80 строк, из них59 numeric и21 known NULL. Текущие цены, услуги и первоначальные значения явно разделены; нет grand total, смешивающего их. Все формулы и exported XLSX readback согласованы с canonical Decimal: округлённая unit BYN затем quantity. Formula errors0, root лично подтвердил preview. Источники official NBRB archive2 rates указаны рядом со строками.

Файл: `D:/Projects/pero_crm_worktrees/correction-42/.playwright-mcp/round2/report/outputs/01a0f928-8f9a-7230-9cfe-f2691a0ff5e0/NON_BYN_PROJECT_PRICES.xlsx`.

Actual app source SHA256: `859b11ee27f82fcc5cd0d42763e125e07de547a004970a91d4455e53bb45449e`.
Canonical report SHA256: `33af45f406d52b543062248bd24e2a6b271fcc5ff9a427a9cfeb096646e82a4b`.

Это отчёт для владельца и доказательство его источника. Его создание не изменяет production данные.

## Что осталось

- Завершить actual staging browser и личный просмотр требуемых артефактов.
- Только после actual PASS отметить runtime acceptance и завершить QA/docs commit с source parity проверкой.

Без дополнительных source/runtime/DB/Git/SSH операций в этой документальной актуализации. Старые STOP и tracker-документы сохранены как история; restic/дампы/production release исключены.
