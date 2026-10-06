# Проверка задачи90

База: origin/staging 222e86feb4e221d560aa1a1b816cf0e7ef0b417a; ветка bugfix/90. Утверждённый план реализован локально; commit/push и staging пока ожидают прямого разрешения владельца.

- RED: две новые регрессии воспроизвели переписывание снимка и отказ immutable-guard.
- GREEN: весь набор1274/1274; typecheck, Prisma validate, Next build, OpenSpec strict PASS. Lint изменённых файлов:0 ошибок,1 прежнее предупреждение assertManager; build:3 прежних предупреждения.
- Native: существующий pero_crm на127.0.0.1:5433. Все3 этапа:5→6→4→0, повтор UUID, актуальные manager/recipient DTO, сумма PayrollEntry и экономика проекта, нулевая дельта, ошибка после записи конфига, запреты UPDATE/DELETE истории, однократный SKIPPED_ONCE, первая корректировка после нуля без получателя.
- До/после native совпадают fingerprints всех исходных строк, constraints и functions; новые схема/данные откатились, persistedRows0, outbound0. Дампы и restic не использовались.
- Browser: реальные SinglePercentageRow/PercentageRateInput/controllers; транспорт сохранения замокан с управляемым ACK/ошибкой/конфликтом. Все3 поля при1440×900,390×844,360×800: мгновенный draft, Enter, стрелки клавиатуры/экрана, новый ввод поверх старого ACK, потеря ответа и повтор точного UUID/envelope, конфликт, отсутствие horizontal overflow/pageerrors.
- Протокол/PNG: .playwright-mcp/percentage90/receipt.json; desktop и390 PNG лично просмотрены. Браузерная проверка полного staging-приложения с реальным Action/деплой пока не выполнена.
