# Проверки №227

## RED

На исходном `a391e5f1`, 16.11.2026, `pnpm --filter @pero/web exec tsx --test tests/journal-finance-stock-audit.test.ts`: 0 PASS / 3 ожидаемых FAIL.

- Создание материала: нет presentation с полным комментарием/категорией/минимальным остатком.
- Настройки процентов: raw receipt сохранён, но нет сравнения реальных ставок.
- Создание кассы при отказе аудита: касса уже сохранена (1 вместо ожидаемого 0).

## Текущий статус

- OpenSpec strict validation PASS.
- Собственные pnpm dependencies установлены frozen/offline; Prisma client сгенерирован только в этом worktree.
- Foundation №221 получен штатным `git merge --ff-only origin/staging` на `26f1d12a`, без копирования файлов. Собственный Prisma client пересоздан после миграции схемы.
- GREEN: 115/115 выбранных существующих и новых поведенческих тестов; новый набор material/defaults/cash/price/FX — 5/5 PASS. Полная типизация после исправления BigInt literal под существующий target — PASS. Финальная проверка после formatter/native дополнений выполняется отдельно ниже.
- ESLint затронутых файлов: 0 ошибок; прежнее предупреждение `assertManager` в percentage core сохранено.
- БД, storage, staging и production этим агентом не изменялись. Native helper подготовлен для root; ещё не запускался.

## Финальный local cut

- Полный `pnpm --filter @pero/web test`: **1472 PASS / 0 FAIL / 0 SKIP**, 89,84 с. Лог: `.playwright-mcp/journal-227/full-web-tests-final.log`.
- Первый полный прогон выявил четыре устаревшие DI-фикстуры: отсутствовали транзакционный audit delegate, transaction adapter и два поля настоящих ORM-записей. Фикстуры дополнены без ослабления ACL/rollback утверждений; отдельные 27 проверок этих файлов прошли.
- Целевой набор foundation+финансы/склад/логистика: **136/136 PASS**. Новые регрессии включают полные снимки, неизменность raw квитанции и replay, rollback кассы/расценки, атомарное отложенное начисление и точное отображение долей.
- Финальный `tsc --noEmit --incremental false`: PASS, включая native helper. ESLint: 0 ошибок, одно прежнее предупреждение `assertManager` в percentage core. Новые тесты/изменённые фикстуры — без предупреждений.
- `openspec validate journal-finance-stock-audit --strict` и `git diff --check`: PASS.
- Runtime/native и staging-приёмка остаются отдельным незавершённым пунктом3.2. Root получает `probe(tx: Prisma.TransactionClient)` в `tests/helpers/journal-227-native.ts`; он требует квалифицированную caller-owned rollback-only tx, берёт общий денежный lock и читает metadata gate. ACTIVE дополнительно проверяет движение/выдачу/каскадную отмену; другой допустимый phase возвращает явный `stockContext=guard-refused`. FROZEN/VERIFYING отклоняются metadata gate. Глобальные настройки и gate не изменяются.
- Коммит, push и Git-интеграция №227 агентом не выполнялись.

## Исправления независимого ревью

- Ветка `settleSkippedPercentage` первоначально была отмечена ревью как изменение без аудита: DI-дубль допускал SKIPPED_ONCE → LEGACY_PROTECTED. Фактическая PostgreSQL-проверка root опровергла эту предпосылку: immutable trigger отклоняет переход с P0001 до записи аудита. Последняя функция из `20261010200000_product_status_optional_assignees` разрешает только SKIPPED_ONCE → SETTLED либо PENDING_FX → SETTLED, а не LEGACY_PROTECTED даже при неизменной reason. Добавленный недостижимый audit и DI-успех-claims удалены по решению root; исходный бизнес-код и SQL guard сохранены. Это не пропуск аудита успешной операции; изменение бизнес-правила вне №227.
- Добавлены точные labels `softDelete`/`correct`; LEGACY_PROTECTED показывается «Защищено историческим начислением», SKIPPED_ONCE — «Начисление пропущено» для существующих снимков. Неиспользуемый новый action alias удалён; собственные 19 action codes имеют переводы.
- В существующие PostgreSQL finance-сценарии добавлены утверждения labels фактического удаления склада и исправления рейса. Root native helper проверяет обе guard-refusal причины (изменённую и совпадающую) на собственных pool/completion rows, точный P0001/immutable и отсутствие новых событий/изменения данных после rollback savepoint; затем продолжает положительные finance/stock/logistics сценарии. Эти DB-проверки агент не запускает.
- После correction: **90/90 targeted PASS**, полный TypeScript PASS, scoped ESLint PASS без предупреждений, `git diff --check` PASS. Предыдущий полный web-run1472/1472 относится к cut до двух новых protection-тестов; новый полный CI/native остаётся за root.
- До обновления evidence изменения относительно первого review cut ограничены labels.ts, direct-completion.ts, journal-percentage-settlement.test.ts, journal-227-native.ts и добавлением утверждений в integration/finance-postgres.test.ts. Остальной production diff заморожен.

## Совместимый refresh интерфейс

Для задачи №222 экспортирован `formatJournalDisplayValue(value, path, entity, links = [])`. Refresh существующих typed before/after вызывает его без links и сохраняет исторические имена; повторное форматирование процентов и русских enum идемпотентно. Проверка nested arrays, точных процентов, переводов и snapshotnames: PASS. №222 добавляет тот же export на своей базе до интеграции №227, не меняя шкалы.

Актуальный cut после удаления недостижимого audit: **37/37 targeted PASS**, полный TypeScript PASS, scoped ESLint PASS. Две прежние DI-успех-проверки удалены, поскольку подменяли реальное ограничение PostgreSQL; вместо них root native helper требует отказа P0001/immutable и неизменности данных для обеих причин. Business branch, SQL function и финансовые расчёты не менялись.

## Приёмка root на существующей local БД

Root подтвердил `local227-complete`: PASS, сохранность счётчиков защищённых данных и проверка deferred constraints. В native helper root добавил `SET CONSTRAINTS ALL IMMEDIATE` до обязательного отката собственных строк; эта правка включена в задачу.

На local склад UNINITIALIZED: подтверждён отказ без движений, фаза не менялась. Положительные material/article/payment/raw-replay/logistics сценарии и оба immutable guard отказа прошли. Read-only проверка root обнаружила ACTIVE на staging; положительные stock/каскадная отмена проверяются там после штатного выпуска №227. Actual staging-приёмка остаётся открытой в3.2.

Root разрешил отдельный commit227 и обычное слияние принятого `origin/staging` `a632e1e36326c61f157d3de5d506e533fe0b3ff2` в ветку задачи. Публикацию и интеграцию в staging выполняет root; агент их не запускает.
