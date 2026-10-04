# Приёмка Номенклатуры58

- Actualstage digest967541885:4 logs11:08:39–49UTC PrismaP2022 materialCategory.findMany columnMaterialCategory.revision doesnotexist, stack7730.js→warehouse/items/page. Source6f98. Private warehouse-digest-13873a6b evidence сохранён.
- One schema declaration MaterialCategory.revision удалена. Историческая CREATE TABLE не имеет поля, application/CAS references нет; никакая SQL migration/данные/прочие modelrevision не менялись.
- Initial generated DMMF RED0/1:extra revision; privatePrisma generate6.19.3→GREEN1/1, scopedESLint PASS. Test сверяет настоящий generated scalar/default fields с настоящей исходной warehouse migration.
- Full1189/1189 PASS, TSC/build PASS; independent source reviewer ACK, конкретныхP1/P2 нет.
- Existinglocal warehouse58-local-native-7fcd979d-41e5-482c-9bb5-45a6d20a0d3f/receipt.private.json: freshclientrevisionAbsent; default findMany/create/findUnique/update activefalse→true безselectобхода. ActualexistingADMIN, oneownCategory внутриouterROLLBACK. Originalallphysicaltables/schemaMATCH,persisted0/provider0. DB/warehouse data не изменены.
- StageCI/deployment/newgeneratedclient/readonlywarehouse/items ещё ожидаются; Income61 принимается первым, чтобы не менять образ посередине its3viewport проверки. Main/production не выпускались; restic/dumps/seed/reset/newDB/W07/refresh не трогались.
