# Design

## Context

См. proposal.md. База задачи — feature/159 от origin/staging3819f17; действующий test script запускает tsx --test tests/*.test.ts tests/*.test.mjs. CI устанавливает Chromium и запускает pnpm -r --if-present test. В tests есть настоящие Chromium components, DI, source guards, отдельно native и staging runners. Старый staging-first-wave-runner жёстко привязан к a1123c5 и не подходит текущей ревизии.

## Goals / Non-Goals

**Goals:** Один компактный контрактный реестр и инструкция по его обновлению; локальный воспроизводимый coverage baseline без новых библиотек; явные gaps130–140/165 и основание последующего обслуживания159–163.

**Non-Goals:** Не исправлять production-логику, не удалять текущие tests, не менять CI entrypoint, не выполнять DB/native runner и не менять infrastructure. Полная проверка SHA/target receipts и guarded staging transport реализуются отдельной163. Недоступный iMac141 остаётся BLOCKED.

## Decisions

1. Хранить машиночитаемую матрицу в docs/testing/contract-matrix.json и краткую русскую документацию в docs/testing/README.md. Каждая строка имеет stable ID, requirement, domain, productionModules, test/block/evidenceLevel, required native/runtime/browser checks, gapTasks, evidence(status/revision/target) и review decision на уровне блока. В документации явно разделить полный CI и согласованные целевые модули.
2. Использовать встроенное V8 покрытие Node22 через тестовый entrypoint, а не добавлять c8/istanbul и менять lockfile. Измерительный запуск выполняется отдельно и повторяет существующий набор test файлов. Reporter сохраняет структурированные coverage данные; итоговый runner выделяет согласованный production allowlist и перечисляет отсутствующие модули. Если tsx/source-map не позволяют корректно измерить метрику, отметить её недоступность; не заменять её процентом по транспилированным смещениям.
3. Привязать результат к Git HEAD и content hashes фактических source/test/helper/coverage-input файлов: незакоммиченная рабочая копия не должна представляться чистой ревизией. Хранить полный local report в существующем ignored .playwright-mcp/coverage-baseline; в change — безопасную сводку без токенов, сессий и PII.
4. Node покрытие исключает helpers/tests/vendor; настоящий Chromium компонент фиксируется как Chromium-component по реально проверенному browser запуску, а не по coverage Node-процесса, который лишь собрал bundle. SQL semantics/concurrency и HTTP/runtime остаются отдельными доказательствами. Глобальный coverage threshold и процент якобы всего приложения не вычисляются.
5. Действующие source guards и historic settlement suites сохраняются. Source JSX navigation блок — REWRITE160; module cache fixtures — CONSOLIDATE161; orphan блоки — RETIRE155/156 только после сохранения действующих контрактов. Решение не применяется самим159.
6. Перед staging-приёмкой159 проверить реально опубликованный candidate SHA и health штатным transport. Поскольку production-код159 не меняется, достаточны проверка source pins карты/report-инструмента, локальный baseline и read-only HTTP smoke принятого staging. В159 подготовить точный read-only обзор существующего crm-modernization-staging.py и package/runtime guards; реализацию нового target-evidence инструмента оставить163.

## Risks / Trade-offs

- [V8 summary зависит от tsx sourcemaps] → отдельная проверка маленькой настоящей функции до полного прогона; недоступные метрики честно BLOCKED.
- [Node не покрывает browser bundle] → отдельный уровень Chromium, без переноса Node-процента в UI.
- [Фальшивая SQL-конкурентность fixture] → явная DI метка и native gap; fake queue lock не считается PostgreSQL доказательством.
- [Матрица устаревает с исправлениями] → stable контракт IDs, проверяемые пути и ссылка на задачи;163 добавляет ревизионные receipts.
- [Параллельные full builds/tests перегружают рабочую станцию] →159 владеет единственным полным coverage запуском; root получает сообщения о старте/завершении.

## Migration Plan

Миграций нет. После local и независимого review обычный merge feature/159 в staging. Root проверяет CI API и фактическую deployed ревизию/HTTP smoke. Main не изменяется. Возврат tooling159 — новый reviewed commit, без БД/данных.