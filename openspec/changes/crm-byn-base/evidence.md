# Evidence

## Scope

Дата: 02.10.2026. Владелец разрешил выполнение №16 до tested staging, включая согласование OpenSpec, реализацию, коммит и обычный merge. Main/production исключены. Этот файл фиксирует фактическую локальную проверку рабочей feature/16 и read-only staging-preflight, предоставленные оркестратором; он не является staging runtime-приёмкой или production-подтверждением. До коммита локальный checkout не имеет release SHA этой фичи.

## RED / GREEN

Первый целевой domain RED: 11 тестов, 5 pass и 6 ожидаемых failures — foreign new percentage/allocation/accrual и смена проектной/зарплатной валюты ранее допускались. После реализации domain+соседние suites прошли; добавлены проверки frozen USD/EUR PENDING_FX retry с BYN-эквивалентом и отсутствием дубля, Decimal top-up, unknown debt/balance без writes. Preview RED: 3 проверки, 2 failures; GREEN подтверждает новый DRAFT BYN при старой USD-setting, запрет foreign проектной базы до FX и сохранение валюты settled snapshot. Финальные сводные результаты ниже заменяют промежуточные counts.

## Local Automated Checks

| Проверка | Фактический результат |
|---|---|
| Web tests | 576/576 PASS |
| Telegram bot tests и typecheck | 11/11 PASS; typecheck PASS |
| Web TypeScript | PASS |
| Lint | 0 errors; только прежнее предупреждение cleanup-uploads |
| Production-mode local build | PASS; это локальный build, production deployment не проверялся |
| Deploy test suite | 73 всего: 71 PASS, 2 Windows SKIP; skipped не считаются выполненными |

Тесты проверяют BYN writers/отказы старых форм и callbacks, fixed snapshots/историю, валютные кассы и новые внутренние эквиваленты, права/nullable итоги/foreign frozen retry. InitialPrice №26, новые процентные формулы №23–24 и миграция цен не выполнялись.

## Local Native Runtime

На существующем guarded local DB оркестратор выполнил 6 native проверок реальных доменных денежных путей. Транзакция точно откатилась; хэши 9 проверенных таблиц совпали до/после. Это runtime-проверка local, не staging и не production. Разрешённый W07/HMAC-контур валидирует identity/target перед работой; guards не обходились. Дампы/reset/seed/restic не использовались.

## Local Browser

58 проверок четырёх профилей ADMIN, MANAGER, MANAGER+ENGINEER и ENGINEER прошли на 320×800, 360×800, 390×844, 768×1024, 1024×768 и 1440×900. Проверены валютные формы/настройки/денежные представления, sidebar и адаптивность; минимальная responsive правка существующей шапки устранила tablet/zoom переполнение без redesign карточки.

Артефакты: `.playwright-mcp/modernization/local-browser-839b951c-d2bf-437e-be8d-73f540563183/`: screenshots, browser receipt, own-writes и restore receipt. Хэши 15 business/audit/time таблиц сохранены. Захваченные preferences восстановлены через CAS; restore receipt имеет статус `RESTORED`. Password-login отдельно не утверждается: browser receipt использует supplied short-lived sessions.

Browser runner первоначально проверял CSS zoom; это не выдано за нативный browser zoom. Отдельная фактическая проверка Chrome tab zoom прошла: chrome.tabs.setZoom/getZoom подтвердили 2, CSS viewport 1424→712, DPR 1→2, CSS zoom остался 1; горизонтального выхода нет. Temporary owned profile удалён. Артефакты: `.playwright-mcp/modernization/local-zoom-17b5860e-d4ee-4e8e-b782-4ef320181181/crm-browser-zoom-receipt.json` и screenshot/restore receipt.

QA-артефакты и приватные runtime файлы ignored; секреты не включаются в коммит. Все изображения/браузерные результаты принимал оркестратор, автор этой сводки не выполнял повторную browser-приёмку.

## Staging Read-Only Preflight

Оркестратор под W07 identity подтвердил 184 проекта: 174 BYN, 8 RUB, 2 USD; payrollCurrency=BYN; Payroll/Payout с отсутствующим bynAmount — 0; 221 PriceItem, 6449 Work. Десять non-BYN проектов сохраняются, их цены/валюта агентом не конвертируются. Локальные проверки fail-closed/guards дают основание перейти к разрешённой staging-приёмке, но сам preflight не подтверждает фактический runtime новой staging-ревизии.

## Pending Acceptance

5.2 commit/обычный merge/CI и 5.3 фактические staging SHA/образ/health/денежные/ролевые/browser сценарии остаются pending до выполнения оркестратором. Не объявлять tested staging по локальному build или source equality. Refresh/W07 сохраняются. Production manual gate и отдельное разрешение выпуска остаются будущими; production DB, deployment и миграции этой задачей не проверялись/не изменялись.

Последняя денежная поправка: Decimal ROUND_HALF_UP проверен для 0,05 USD × 0,7 = 0,04 BYN. Реальный local native runner повторён: 7 проверок, полный rollback и неизменные отпечатки таблиц; сборка повторена успешно. Серверные лимиты складывают Decimal без промежуточного number.

## Staging acceptance 02.10.2026

Принята фактически развёрнутая ревизия 9fb844fc4b427cfa6df5c7d7741d79496260e328, образ sha256:dbcf9022d5fd03601c66d85eb79f9355300cdb1aff5ee3111eee07624d2ebf72; web/db healthy, прежние DB ID/StartedAt/том и W07 SHA сохранены. Native PostgreSQL: 7 проверок, полный rollback и совпавшие отпечатки. Compiled browser: 46 проверок ADMIN/MANAGER/ENGINEER в шести размерах, captured prefs CAS RESTORED, business/audit/time отпечатки совпали. Совмещённого MANAGER+ENGINEER в staging нет; этот сценарий проверен на local и unit, отсутствующую hosted-проверку не выдаём за выполненную. Настоящий browser tab zoom 200% проверен отдельно: PASS, профиль удалён точно по своему пути.

Receipts: .playwright-mcp/modernization/staging-native-fb26926a-66e1-45da-9895-693b0de752a9/native-receipt.json; staging-browser-59de57ea-d545-4966-b2d5-63b1766db6fa/browser-receipt.json; staging-zoom-baf21a99-427a-42c0-9161-07eacba06182/browser-receipt.json. CI logs недоступны с текущими read:packages credentials; публикация образа gated needs:test в проверенном workflow. Git merge обычный, main остаётся f036823. Проверки не используют дамп, restic, новые БД или изменения production.

QA упаковка исправлена после фактической проверки standalone image: реальные Zod factories bundled вместо отсутствующей внешней зависимости; namespace неиспользуемых locales исключён, размер 97 305 байт в пределах неизменённого 256 KiB guard. Серверное ядро и валидаторы не подменяются. Приватный stderr сохраняется только локально, наружу выдаётся безопасный код ошибки. Исправленные инструменты реально выполнены на принятой staging-ревизии.
