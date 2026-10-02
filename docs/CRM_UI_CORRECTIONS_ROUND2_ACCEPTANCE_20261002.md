# Round2 CRM: проектная приёмка от 02.10.2026

## Статус новой APP revision065

Все app-задачи39–45 реализованы. Root интегрировал полный source в feature42; последняя локальная ревизия065 прошла953/953 tests и NextBuild. CI94 run37065325423 завершён успешно. Actual hosted browser065 прошёл60 checks с полным cleanup. Main f036 остаётся прежним, выпуск в production не разрешён.

## Локальные проверки и дата SSR

Actual local 065: 62 checks PASS, 7 файлов, ошибок нет; CLEANED/original MATCH/prefs RESTORED 26. Receipt: `correction-41/.playwright-mcp/corrections/local-corrections-b7a9dd62-252e-4162-b4bf-9fe414b05dc5/final-receipt.json`. Native42 local/staging: 5 групп PASS, all 43 rollback verified, externalFetch=0. Root лично просмотрел предыдущие local1440/390 и XLSX preview.

Stage a160 run eb5 сохранил60 assertions, но React 418 / pageErrors=1 сделал результат FAIL. Причина подтверждена реальными DateStrings: UTC02.10 против Europe/Moscow03.10, FileGrid использовал другую timezone. FormatDate Europe/Moscow теперь единый для lib/format, FileGrid и TaskDialog; SSR child-TZ RED→GREEN, 23. Quantity labels/104px — отдельный узкий UI fix, без изменения controllers; targeted 10 PASS.

Local 1aee FAIL после 48 checks и30ac FAIL после 52 checks, stageeb5 FAIL и старые STOP сохраняются с успешным cleanup; их результаты не переименовываются в PASS. CI 93/a160 health/native доказательства относятся к предыдущей APP ревизии и не заменяют будущую hosted UI приёмку065.
## №46: данные тестовых окружений

Root применил V3 на actual staging02d7/image14f: 10 проектов и20 изделий в точной области плана; all-other DATA MATCH. Post-readonly: staging184 BYN, foreign=0. Local174 BYN, foreign=0. Повтор того же плана дал ALREADY_APPLIED, committed=false, MATCH 10/20: повторных business writes нет.

Первоначальные STOP сохранены. TS CLI остановился до DB и заменён ESM builder. Raw pg_advisory void остановился до writes и исправлен SELECT1. Два original-fingerprint stale результата вызваны operational `ApiToken.lastUsedAt`. Подписанный V2 profile исключает только этот timestamp и отвергает старые manifests; финансовые таблицы и другие поля остаются строго защищёнными. Ни triggers, backup/reset, migration, ни production DB не использовались.

Эта проверка данных не заменяет приёмку новой APP revision a160.

## №32: единственный отчёт по production app

Production источник получен обычным read-only Collector через приложение: полный список191, валютных проектов10, недоступных details0. Business POST и direct production DB не выполнялись.

Создан один `NON_BYN_PROJECT_PRICES.xlsx`: 10 проектов, 80 строк, из них59 numeric и21 known NULL. Текущие цены, услуги и первоначальные значения явно разделены; нет grand total, смешивающего их. Все формулы и exported XLSX readback согласованы с canonical Decimal: округлённая unit BYN затем quantity. Formula errors0, root лично подтвердил preview. Источники official NBRB archive2 rates указаны рядом со строками.

Файл для владельца: `NON_BYN_PROJECT_PRICES.xlsx`.

Actual app source SHA256: `859b11ee27f82fcc5cd0d42763e125e07de547a004970a91d4455e53bb45449e`.
Canonical report SHA256: `33af45f406d52b543062248bd24e2a6b271fcc5ff9a427a9cfeb096646e82a4b`.

Это отчёт для владельца и доказательство его источника. Его создание не изменяет production данные.


## Итог: №39–46 завершены

Actual staging `065ab453d4ddea025f15cf4b72b0617c0c1bfd86`, healthy image `253b3a39b209be61a5b0fa267f458086b62d7beabce203904cb90fbeb98c1101`. CI94 SUCCESS: test4m19/build3m45/bot1m8. Stage receipt 877d3374: PASS 60 checks/7 files, pageErrors=0/protocolStopped=false/skips[]/zoom PASS, CLEANED/original MATCH/prefs RESTORED 22 (21 unchanged, 1 restored). Local 065 b7a: PASS 62 / 7, CLEANED/MATCH/RESTORED 26. Разница count связана с отсутствием combined-role пользователя на staging, без fake users.

Native42 actual 5 groups / all 43 rollback local/staging подтверждает неизменённый backend; stage native a160 source-equivalent 065 по backend. Данные №46: 184 BYN staging/174 BYN local, foreign=0; replay ALREADY_APPLIED/committed=false. №32 также завершён: actual production app 191 / 10, один 80-row XLSX, 59 numeric / 21 known NULL, полная Decimal/formula/readback сверка. Source hashes указаны выше.

Все 8 OpenSpec runtime checkboxes завершены. Root заканчивает личный просмотр новых stage 1440 / 390/cover; previous local2 и XLSX уже просмотрены. Старые React418/helper FAIL и STOP сохранены с их cleanup; timezone fix является доказанным исправлением, не ослаблением assertions.

После QA/docs follow-up root проверяет source parity и фактическую deployed revision. Новых APP изменений в этом документальном update нет. Main f036 остаётся прежним, main/production release не разрешён. Restic/дампы/production DB не использовались.
