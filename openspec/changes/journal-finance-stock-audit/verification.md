# Проверки №227

## RED

На исходном `a391e5f1`, 16.11.2026, `pnpm --filter @pero/web exec tsx --test tests/journal-finance-stock-audit.test.ts`: 0 PASS / 3 ожидаемых FAIL.

- Создание материала: нет presentation с полным комментарием/категорией/минимальным остатком.
- Настройки процентов: raw receipt сохранён, но нет сравнения реальных ставок.
- Создание кассы при отказе аудита: касса уже сохранена (1 вместо ожидаемого 0).

## Исторический локальный этап до runtime-проверок

- OpenSpec strict validation PASS.
- Собственные pnpm dependencies установлены frozen/offline; Prisma client сгенерирован только в этом worktree.
- Foundation №221 получен штатным `git merge --ff-only origin/staging` на `26f1d12a`, без копирования файлов. Собственный Prisma client пересоздан после миграции схемы.
- GREEN: 115/115 выбранных существующих и новых поведенческих тестов; новый набор material/defaults/cash/price/FX — 5/5 PASS. Полная типизация после исправления BigInt literal под существующий target — PASS. Финальная проверка после formatter/native дополнений выполняется отдельно ниже.
- ESLint затронутых файлов: 0 ошибок; прежнее предупреждение `assertManager` в percentage core сохранено.
- БД, storage, staging и production этим агентом не изменялись. На этом локальном этапе native helper был подготовлен для root, но ещё не запускался.

## Финальный local cut

- Полный `pnpm --filter @pero/web test`: **1472 PASS / 0 FAIL / 0 SKIP**, 89,84 с. Лог: `.playwright-mcp/journal-227/full-web-tests-final.log`.
- Первый полный прогон выявил четыре устаревшие DI-фикстуры: отсутствовали транзакционный audit delegate, transaction adapter и два поля настоящих ORM-записей. Фикстуры дополнены без ослабления ACL/rollback утверждений; отдельные 27 проверок этих файлов прошли.
- Целевой набор foundation+финансы/склад/логистика: **136/136 PASS**. Новые регрессии включают полные снимки, неизменность raw квитанции и replay, rollback кассы/расценки, атомарное отложенное начисление и точное отображение долей.
- Финальный `tsc --noEmit --incremental false`: PASS, включая native helper. ESLint: 0 ошибок, одно прежнее предупреждение `assertManager` в percentage core. Новые тесты/изменённые фикстуры — без предупреждений.
- `openspec validate journal-finance-stock-audit --strict` и `git diff --check`: PASS.
- На этом локальном срезе runtime/native и staging-приёмка ещё оставались незавершённым пунктом3.2. Root получил `probe(tx: Prisma.TransactionClient)` в `tests/helpers/journal-227-native.ts`; он требует квалифицированную caller-owned rollback-only tx, берёт общий денежный lock и читает metadata gate. ACTIVE дополнительно проверяет движение/выдачу/каскадную отмену; другой допустимый phase возвращает явный `stockContext=guard-refused`. FROZEN/VERIFYING отклоняются metadata gate. Глобальные настройки и gate не изменяются.
- До последующего COMMIT GO коммит, push и Git-интеграция №227 агентом не выполнялись.

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

На local склад UNINITIALIZED: подтверждён отказ без движений, фаза не менялась. Положительные material/article/payment/raw-replay/logistics сценарии и оба immutable guard отказа прошли. На момент local-приёмки read-only проверка root обнаружила ACTIVE на staging; положительные stock/каскадная отмена и пункт3.2 ещё ожидали штатного выпуска №227. Их окончательный результат приведён ниже.

Root разрешил отдельный commit227 и обычное слияние принятого `origin/staging` `a632e1e36326c61f157d3de5d506e533fe0b3ff2` в ветку задачи. Публикацию и интеграцию в staging выполняет root; агент их не запускает.

## Совместимость с принятым staging

Собственный commit №227: `7855a099e22c5647cc4a3787516a470eb1bd5c8e`. В обычном merge `a632e1e3` единственный конфликт presentation.ts разрешён точечно: общий public formatter export/recursion №222, процентные шкалы №227 и принятый rawBefore/rawAfter diff сохранены вместе. Combined targeted: **140/140 PASS**, полный TypeScript PASS, formatter ESLint и strict OpenSpec PASS. На этом срезе actual staging №227 и положительная stock-ветка ещё ожидали root-публикации и runtime-проверки.

## Фактическая staging-приёмка №227

Root принял область №227 на развёрнутой ревизии **`e3f99ff05b97f3999fc8fbf74472e9077d769a3b`** после штатного **CI43796217344: 7/7 SUCCESS**. Web/renderer healthy, HTTP200; идентичность, время запуска и volume БД и внешний W07 сохранены.

- Web image: `sha256:7a08b609684a03aad93249ca9f190ef688571fbe5de2b3bd163a6443dba0cc2a`.
- Renderer image: `sha256:8fb1087afd508f9506952c4b16279adeccc7a27df353472eff485edf7770a19f`.
- W07: `27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139`.
- Private receipt: `D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/stage-final227.response.private.json`; SHA256 файла `51bb7904110359787ca3ec6e499f9cc314c84d3d4addf30134afd98d6934cbc7`.
- Квалифицированный native bundle: `f2a6757faf853d8c1a6c8db4894f16b19477b81034a2bbe0d138f0409d85e6c7`.

Receipt подтверждает `exitCode=0`, `status=PASS`, `receipt.ok=true`, **`stockContext=verified` при реальном ACTIVE**, `rollback=true`, `auditCountPreserved=true`.

Положительная складская ветка выполнила инвентарный приход, выдачу изделию, повтор выдачи, предварительный расчёт и каскадную отмену прихода, затем повтор отмены. Assertions проверили сумму выдачи 8.75 BYN, ровно один audit выдачи до отмены, product-only контекст, русское «Удаление», System/инициатора зависимой отмены и неизменённый raw payload `{deletionId, rootMovementId}`. Фаза склада не менялась.

Остальные receipt checks: `legacy-protection-immutable-guards`, `material-full-snapshot`, `article-active`, `payment-full-snapshot`, `payment-raw-receipt-replay`, `logistics-context-and-diff`, `deferred-constraints`. Перед обязательным SAVEPOINT rollback выполнен `SET CONSTRAINTS ALL IMMEDIATE`. Историческая попытка SKIPPED_ONCE → LEGACY_PROTECTED проверена как два отказа текущего SQL guard с P0001/immutable и сохранностью данных; успешного перехода или нового аудита для неё не заявляется.

Root подтвердил сохранность исходных **5529 raw-записей** после deployment и финального refresh: контрольный fingerprint `64bcf0448dabe8e594a5ffa37da4aa1a` не изменился. Дополнительные производные поля presentation/searchText не подменяют исходные факты.

Для standalone native bundle использована только QA-граница импорта Next cache: вызов немедленно бросает исключение и увеличивает счётчик; процесс завершается ошибкой при любом ненулевом счётчике, даже если исключение было поглощено. Вызовов — 0. Это не доказательство работы Next cache invalidation; native227 не вызывает внешние action/service-обёртки с инвалидацией.

Пункт3.2 закрыт для №227. Общая финальная браузерная приёмка остальных задач остаётся отдельной работой root и этим receipt не объявляется завершённой.
