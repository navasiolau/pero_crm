# Evidence

## Scope

Дата: 02.10.2026. Владелец разрешил выполнение №16 до tested staging, включая согласование OpenSpec, реализацию, коммит и обычный merge. Main/production исключены. Этот файл фиксирует фактическую локальную проверку рабочей feature/16 и read-only staging-preflight, предоставленные оркестратором; он не является staging runtime-приёмкой или production-подтверждением. До коммита локальный checkout не имеет release SHA этой фичи.

## RED / GREEN

Первый целевой domain RED: 11 тестов, 5 pass и 6 ожидаемых failures — foreign new percentage/allocation/accrual и смена проектной/зарплатной валюты ранее допускались. После реализации domain+соседние suites прошли; добавлены проверки frozen USD/EUR PENDING_FX retry с BYN-эквивалентом и отсутствием дубля, Decimal top-up, unknown debt/balance без writes. Preview RED: 3 проверки, 2 failures; GREEN подтверждает новый DRAFT BYN при старой USD-setting, запрет foreign проектной базы до FX и сохранение валюты settled snapshot. Финальные сводные результаты ниже заменяют промежуточные counts.

## Local Automated Checks

| Проверка | Фактический результат |
|---|---|
| Web tests | 574/574 PASS |
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
