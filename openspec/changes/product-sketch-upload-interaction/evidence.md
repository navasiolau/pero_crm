# Evidence — Round2, №43

## Проверяемый результат

№43: неподвижная область эскиза принимает выбор и drop; кнопка добавления чёрная, урна красная, загрузка работает через подтверждённый server ACK. Реализация завершена. Runtime checkbox завершён после actual staging browser подтверждения APP 065.

## Локальная проверка текущей ревизии

Root подтвердил полный suite953/953 PASS и NextBuild PASS. Local 065 browser: 62 checks PASS, ошибок нет, 7 owned файлов; cleanup CLEANED, original MATCH, prefs RESTORED 26. Receipt: correction-41/.playwright-mcp/corrections/local-corrections-b7a9dd62-252e-4162-b4bf-9fe414b05dc5/final-receipt.json. Предыдущий local8bdf также прошёл62 checks с таким же cleanup. Root лично просмотрел предыдущие local1440/390 и XLSX preview; просмотр новой staging ревизии ещё ожидается.

Доказанный shared date fix: server UTC показывал02.10, client Europe/Moscow —03.10. Формат FileGrid отличался по timezone. Теперь formatDate использует Europe/Moscow в lib/format, FileGrid и TaskDialog; реальный SSR child-TZ regression прошёл RED→GREEN, 23. Два quantity поля получили подпись «Количество» и ширину 104 px; controllers не менялись, targeted 10 PASS.

## Сохранённые failures

Stage a160 run eb5 выполнил60 assertions, но имел React 418 / pageErrors=1 и потому остался FAIL; original MATCH и prefs RESTORED подтверждены. Local 1aee FAIL после 48 checks и30ac FAIL после 52 checks также сохранены с cleanup: исправлялись helper Node и выбор вкладки, не ослаблялись assertions. Старый62 STOP/recovery и original receipts не переписаны.

## История предыдущей ревизии a160

Actual a160 был healthy, image e01c37d1b51604257d5baec6022cd8d6ce2742223a325ae41a0361dfedef1dc7; CI 93 SUCCESS. Native №42 на staging: 5 групп PASS, all 43 rollback verified, externalFetch=0. Эти результаты не заменяют UI browser проверку исправленного APP 065.

CI94 run37065325423 теперь SUCCESS. Прежний промежуточный pending статус закрыт actual hosted065 PASS 60, указанным ниже. Локальные62 и hosted60 не смешиваются; завершение runtime основано на actual hosted receipt.

## Данные и отчёт

Data №46 V3: actual stage 02d7 / image 14f, 10 проектов/20 изделий, all-other DATA MATCH; post-readonly staging: 184 BYN, foreign=0, local: 174 BYN, foreign=0. Повтор: ALREADY_APPLIED, committed=false, MATCH 10/20. Signed V2 исключает только operational ApiToken.lastUsedAt и отвергает старые manifests; финансовые и другие поля остаются строгими. Triggers, backup/reset, миграции и production DB не обходились.

№32 завершён после получения actual production app source: 191 проектов/10 валютных, detailsUnavailable0. Один NON_BYN_PROJECT_PRICES.xlsx содержит 80 строк: 59 numeric и21 known NULL; canonical Decimal/formulas/readback согласованы, root подтвердил preview. Actual source SHA256: 859b11ee27f82fcc5cd0d42763e125e07de547a004970a91d4455e53bb45449e, canonical SHA256: 33af45f406d52b543062248bd24e2a6b271fcc5ff9a427a9cfeb096646e82a4b. Прежний №32 LOGIN-blocked статус исторический и superseded этим фактом; старые документы/FAIL receipts сохранены.

Main f036 не изменён, production release не разрешён. Эта актуализация касается только документов; source/Git/runtime/DB/SSH/restic/дампы не выполнялись.

## Итоговая hosted приёмка

Root подтвердил actual staging `065ab453d4ddea025f15cf4b72b0617c0c1bfd86`: healthy image `253b3a39b209be61a5b0fa267f458086b62d7beabce203904cb90fbeb98c1101`. CI94 SUCCESS: test4m19/build3m45/bot1m8.

Receipt: `correction-41/.playwright-mcp/corrections/staging-corrections-877d3374-4562-489f-b6a7-84e3f9f5e0b3/final-receipt.json`. PASS 60 checks / 7 files, pageErrors=0, protocolStopped=false, skips[], zoom PASS; CLEANED, original MATCH, prefs RESTORED 22 (21 unchanged, 1 restored). На staging нет пользователя с combined role, поэтому60 против local 62; пользователи не создавались для искусственного выравнивания count. Local 065 b7a также PASS 62 / 7 с полным cleanup.

Native №42 actual local/staging: 5 групп, all 43 outer rollback verified. Staging native выполнен на a160; backend source в 065 не менялся, поэтому SQL/ACL proof применим к065. Browser 065 отдельно доказывает исправленный UI/SSR. Data №46: staging: 184 BYN / local: 174 BYN, foreign=0, повтор ALREADY_APPLIED/committed=false. №32 actual production app source 191 / 10 и один 80-row XLSX завершены, без production DB изменений.

Все runtime пункты39–46 отмечены по этим фактам. Root выполняет завершающий личный просмотр новых stage1440/390/cover; предыдущие local1440/390 и XLSX preview уже просмотрены. Старый a160 React418 FAIL и helper failures сохраняют прежние статусы и cleanup. Date fix подтверждён реальным SSR timezone regression, не скрытием ошибки.

Main f036 не изменён; production release не разрешён. Документы заморожены после этой актуализации, no source/Git/runtime/DB/SSH/restic/дампы.
