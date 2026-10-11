# Design

## Context

См. proposal.md. В actual staging ledger хранится checksum исходного SQL d0948074ff79ac17f365490440c851650550910a6909d952ca278464b3f80a62. Принятый Git d121 содержит старые пять строк и добавленный INSERT, checksum 277540457e9b832e483e0f3de3d09ee47d313bf845388605c6fd03be0488ee96. Нормализованные SQL различаются по смыслу; это не четвёртый вариант окончаний строк. Actual local history ещё не квалифицирована: stage-наблюдение её не заменяет.

## Goals / Non-Goals

**Goals:** восстановить неизменяемую историю исходников, вынести недостающее заполнение в новую миграцию и доказать сохранение всех существующих данных на разрешённых existing local/staging БД.

**Non-Goals:** новые БД, схемы, стенды, reset/seed/dump/restic; повтор двух исторических UPDATE на рабочей БД; Prisma resolve или изменение старых ledger rows; UI/API/роли/формулы; main/production. Проверка bootstrap новой БД обозначается NOT_RUN_FORBIDDEN_SCOPE.

## Decisions

1. **Неизменяемый старый SQL.** Восстановить byte-exact Git blob 9759270d3116248cf09eae309f8c8cacdaf6b808 из commit 2d50eb510893d781d47afdfed97333168764c614. SHA файла обязан быть d094…; символы окончаний строк не менять. Альтернатива принять текущий INSERT за CRLF-вариант отвергнута: SQL неэквивалентен.
2. **Отдельный атомарный INSERT.** Новый `20261011130000_product_percentage_missing_configs/migration.sql` содержит один INSERT с NOT EXISTS по паре productId/kind и ON CONFLICT(productId,kind) DO NOTHING. Нет UPDATE/DELETE/DDL, явного COMMIT или повторного rate/default normalization. Генерируются UUID через существующий gen_random_uuid(); первичный PK conflict не подавляется. Три вида, ставка 0, revision 1, пустые reviewedLegacyWorkIds, прежние timestamps NOW(). Без deletedAt-фильтра: сохраняется прежний охват всех изделий и частичных пар. Одна SQL-команда атомарна и допускает выполнение внутри внешней rollback-only транзакции.
3. **Две исходные истории не подменяются.** До SQL квалифицировать actual local75 и stage74 по имени/checksum/status, каталогу и исходникам. Два известных смысловых варианта старого файла объясняются отдельным evidence: d094 — исходные пять строк, 277540 — расширенные одиннадцать; они никогда не line-ending aliases. Deploy выполняет только новую миграцию, старые ledger entries byte-for-byte сохраняются. Если штатный Prisma инструмент отклоняет modified history, STOP и независимый разбор конкретной ошибки; никаких resolve/reset/ledger rewrite.
4. **Проверки разделены по уровню.** Source RED→GREEN проверяет точные старые bytes, композицию old5+INSERT относительно прежних11 и запрет изменения существующих строк. Cold protocol guards проверяют цель/историю/allowlist/UNKNOWN до эффектов. Native — одна отдельно reviewed existing5433 REPEATABLE READ rollback-only транзакция с двумя owned cohorts: все отсутствующие пары/частичные конфиги/NULL/positive/zero/soft-deleted. Поведенческое сравнение старой композиции ограничивается собственными строками и честно маркируется как scoped reference; исторические UPDATE не запускаются глобально. Actual новый INSERT проверяется отдельно с ожидаемыми global missing pairs и second-run0; точный временный scope и rollback proof утверждаются конкретным протоколом до SQL, без изменения критериев по результату.
5. **Сохранность и отказ.** До первого временного INSERT — immutable PRE и exact target/source pins, полный fingerprint старых configs/OrgSetting/participants/completions/shares/adjustments/payroll/FX/ledger и точный expected missing-pair set. После INSERT фиксируются exact DB-generated IDs всех новых configs, включая missing pairs реальных изделий: UUID не предполагается QA-prefixed. После rollback — fresh read equality и отсутствие всех exact temporary IDs, без новых строк у реальных изделий. Ошибка/неподтверждённый rollback/guard mismatch = HOLD/UNKNOWN, без cleanup/retry. Новые постоянные configs при отдельной approved миграции — единственный разрешённый бизнес delta; никакой перезаписи исходных ставок/истории.
6. **Startup migration — часть deploy.** Accepted apps/web/Dockerfile CMD запускает `prisma migrate deploy` перед web. Root сначала доказывает actual staging command override, если он есть. Если override отсутствует, PRE/protected baseline/history guards и root migration lease MUST существовать ДО push staging; ровно один startup нового accepted image считается approved migration execution. Отдельный повтор manual deploy после startup не разрешается. Watcher/code push сами по себе не доказывают успех и сохранность.

### Exact allowlist

Source (2):
- apps/web/prisma/migrations/20261006180000_product_percentage_nonempty_rates/migration.sql
- apps/web/prisma/migrations/20261011130000_product_percentage_missing_configs/migration.sql

Tests/protocol (3):
- apps/web/tests/immutable-percentage-migration-backfill.test.mjs
- apps/web/tests/immutable-percentage-migration-native.mjs
- apps/web/tests/helpers/immutable-percentage-migration-protocol.mjs

Own OpenSpec artifacts. Shared readonly local75 producer — отдельный ignored supporting QA, не приложение и не дополнительный deploy path. Ветка bugfix/167, worktree D:/Projects/pero_crm_worktrees/improvements-167, base d121. Чужие файлы/lock/schema/client неизменны.

## Risks / Trade-offs

- [Local checksum может быть 277540] → сначала actual readonly qualification, явная проверка поведения штатного deploy, STOP на конфликте; старый ledger не приводится к Git вручную.
- [Параллельное создание конфигурации] → existing unique(productId,kind) + узкий ON CONFLICT DO NOTHING; существующая ставка сохраняется, PK collision остаётся ошибкой.
- [Текущие NULL и исторические выплаты] → новый SQL только INSERT; protected full-row fingerprints до/после, NULL не нормализуется повторно.
- [Legitimate writes меняют protected fingerprint во время native] → root exclusive bounded window; mismatch HOLD, никакой подгонки baseline.
- [Откат применённой миграции] → не удалять новые configs вслепую: они могут получить участников/выплаты. При проблеме остановить rollout и подготовить reviewed forward correction с точным scope.

## Migration Plan

1. Независимо проверить исходные bytes и actual local75/stage74 prehistories на existing БД.
2. Source RED→GREEN, cold guards, reviewed rollback-only native local, fingerprint equality.
3. Независимый final review и атомарный owner-authorized commit только allowlist.
4. Root устанавливает actual command override или заранее создаёт PRE/history/protected guards/lease перед push. Обычный merge/CI/image rollout выполняет новую миграцию ровно один раз штатным механизмом (startup CMD либо отдельно reviewed override); pre/post ledger и missing-pair/config/history проверяются. Без baseline/grant push, который запускает миграцию, запрещён.
5. Actual staging доказывает old entries unchanged, exactly one new finished migration, missing pairs0, existing config/history equality, повтор INSERT0. Только после этого task167/stage prerequisite130 закрываются.
