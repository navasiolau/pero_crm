# Локальная проверка №162

Ветка feature/162 от свежего origin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929. ROOT_IMPLEMENT_SCOPE_GO после независимого DESIGN_SCOPE_GO получен 11.10.2026. Исходники приложения, БД, зависимости/lockfile, инфраструктура и третье семейство113 не менялись.

## Реализованный охват

Четыре модуля warehouse-units-stage-{wire,runner}.mjs и product-draft-stage-{wire,runner}.mjs используют один helpers/qa-private-primitives.mjs. Canonical JSON: 2→1, SHA-256: 3→1, обход предков: 3→1, open/write/fsync/close: 4→1. Новый helper явно включён в source manifests двух runners. Семейные guards, лимиты, wire/gzip, error codes, readback/CAS/ledger и recovery сохранились. warehouse не получил дополнительного readback, которого прежде не было.

## Проверки

- Старый baseline 191/191 PASS (5a9da6): восемь семейных wire/fixtures/browser-guard/runner suite и неизменный file-fixture113-protocol. Browser guards используют stubs, реальный браузер не запускается. Native/SQL/HTTP runners не запускаются.
- RED нового helper: bc6dee, ERR_MODULE_NOT_FOUND до реализации.
- После реализации: все 191 прежняя проверка +10 новых guards, 201/201 PASS (0056c4). Точечная проверка10/10 после самостоятельной подготовки own private results: ddcaba. Точные wire дескрипторы/байты, границы ancestry, wx/a/mode0600, finally-close при write/fsync faults, отсутствие close после open fault, orphan artifact после сбоя ledger, отказ на symlink и source pins подтверждены.
- ESLint six-file allowlist с --max-warnings 0: PASS, 9bb004/ddcaba. Предыдущий один unused import warning c2af6c устранён.
- TypeScript web --noEmit --incremental false: PASS, aea3d3/5e6c96.
- Offline bundles и cold imports в прежних suites PASS; новый helper cold import отказывает любым writes/spawn/network, разрешает только чтение своего модуля Node ESM loader, 6a6510/ddcaba.
- git diff --check PASS. Strict OpenSpec validate повторяется перед передачей review.

## Измерение

Четыре исходных QA-модуля: 48 966 исходных байтов, 264 строки. Четыре модуля + новый helper: 48 978 байтов, 285 строк. Изменение исходного текста +12 байтов/+21 строка; это не объявляется сокращением физических файлов.

Одинаковый esbuild transformSync minify/target node22/format esm для всех модулей области: 37 172→37 145 байтов исполняемого текста, −27 байтов. Главное сокращение — число дублируемых реализаций; новая проверка занимает примерно9,3KiB/120 строк и учитывается отдельно. Это QA-код, не измерение production JS или скорости CRM.

Точные base/current hashes и данные измерения находятся в ignored apps/web/test-results/qa162-before/{baseline.json,measurements-final.json}; frozen original четыре файла сохранены там только для локального сравнения. Исторические публичные source pins/receipts не переписывались.

## Подготовка окружения и предыдущие отказы

Offline frozen install --ignore-scripts: pnpm11.10.0, +724 пакета/download0, 79c628/1d1630. Версии и lockfile не менялись. Первое baseline ca0441/510e2d остановилось на отсутствующем generated Prisma Client. Guard6c0c4c остановил generate до CLI: own schema engine отсутствовал.

После явного ROOT_SCOPE_GO скопированы только два отсутствующих cached engine файла132→162 с exact pre/post SHA и версией6.19.3: schema f2b48e3ce8de8712c9dce6c71f952bec383fa472830b91bca8e64b4b51bf0dd7, query263946105f428384d2318dc3241b85b1c3dd98fbb1bfac62d3e81f513ab35897. Все overrides отсутствовали. Own pnpm db:generate c6301e PASS, без DB/network/migrations. Engine/client artifacts ignored и в коммит не включаются.

Первые новые fixtures debf4d/5c89a8/4fd08f выявили ошибки именно теста: Windows требует privilege для file symlink (заменён own junction); pin assertion имела лишнюю скобку; Node ESM читает модуль через fs.openSync с URL (exact readonly allowlist уточнён). Эти ошибки не выданы за приложение/DB failures; после исправления все guards PASS.

## Независимое review и staging

Независимое SOURCE_CODE_REVIEW_GO получено для exact helper529b3c83/testf0854ef1 и четырёх QA-модулей; ROOT_ATOMIC_COMMIT_GO подтверждён. Коммит выполняется после повторной проверки этих шести SHA. Push/обычный merge/CI и реальная staging-приёмка ещё не выполнены. Main/production остаются запрещены. SAFETY-RULES D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md соблюдаются; STOP при guard mismatch. Restic/dumps/reset/seed/new stand не применялись.
