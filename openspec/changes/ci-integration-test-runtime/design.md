# Design

## Продолжение покрытия — 14.10.2026

Новые проверяемые условия добавляются в существующие domain/finance/HTTP cases и существующие fixture modules. Login использует actual Auth.js credentials flow; бизнес-изменения и Bearer/Telegram/plugin проверки идут через реальные разрешённые серверные границы. Session cookie не выдаётся самостоятельно подписанным JWT за credentials login. Денежные операции сверяют raw Decimal/factual rows, защищённые snapshots, rollback и независимые DB connections для гонок. Пробелы/ручные сценарии отражаются честно в прежней карте; 100% покрытие не заявляется по числу tests.

Нет local/staging fixture writes/stand/seed/reset/dumps. Реальные native/HTTP проверки выполняются одним обычным CI на существующем owned runtime после local checks и независимого review. Историческая приёмка разделов 1–3 сохранена; новый раздел 4 закрывается только по новому CI/staging SHA и exact cleanup evidence.

## Context

Существующий `test` job уже устанавливает pnpm/Node 22, генерирует Prisma, проверяет lint/types/tests и собирает Next.js. Production Compose использует PostgreSQL 17. Инвентаризация MinIO фиксирует `RELEASE.2025-09-07T16-13-09Z`. Первый CI доказал отказ Docker Hub; Quay не даёт anonymous pull, официальный binary archive отвечает 410. Поэтому временный CI-образ собирается из официального исходного кода того же release.

## Goals / Non-Goals

**Goals:** один общий runtime и настоящие DB/S3 контракты; минимальный дополнительный код; подтверждение удаления стенда.

**Non-Goals:** новая функция CRM, QA-framework, смена зависимостей, рабочие БД/S3, PVE/VPS, main/production.

## Decisions

1. PostgreSQL `postgres:17-alpine` — штатный service test job, `127.0.0.1:55432/pero_ci`; данные в tmpfs. GitHub владеет удалением service/network, повторного удаления нет.
2. MinIO — официальный signed tag `RELEASE.2025-09-07T16-13-09Z`, commit `07c3a429bfed433e49018cb0f78a52145d4bedeb`; checksum codeload archive `8819e3e7817e46b7b3798f8f200ead208562e571563c2e040352378031abe9f2`. Go `1.24.2` соответствует source toolchain; официальный builder закреплён OCI digest `7772cb5322baa875edd74705556d08f0eeca7b9c4b5367754ce3f2f00041ccee` с linux/amd64. `-mod=readonly`, `GOTOOLCHAIN=local`; версии из upstream go.mod/go.sum. Owned образ получает run/attempt/service/commit labels, запускается на job network с loopback 59000 и tmpfs `/data`, после контейнера удаляется и сам образ. Production не меняется.
3. `assertCiRuntimeTarget()` возвращает validated `runId`, `attempt`, `databaseUrl`, `baseUrl`, `s3`, `authSecret`; фикстуры вызывают его до создания клиентов. Runner дополнительно сверяет metadata Docker, отсутствие env-файлов и точную принадлежность ресурсов до миграций. Только `prisma migrate deploy`, без seed/reset/dump.
4. Единственная имеющаяся сборка используется через Next production на `http://127.0.0.1:3100`; `tsx --test --test-concurrency=1 tests/integration/*.test.ts`. Фикстуры и случаи принадлежат профильным авторам; ID и protected baseline общие.
5. `finally` и шаг `always()` завершают owned tests/web и удаляют только owned MinIO-контейнер и образ. Cleanup повторяем, guard при несоответствии останавливает удаление. Журнал сообщает отсутствие контейнера, образа и постоянного data volume. Системный `Stop containers` служит доказательством удаления PG/network, включая отменённый run.

## Risks / Trade-offs

- [Отмена до обычного finally] → дополнительный `always()` cleanup и уничтожение hosted runner стандартным lifecycle; evidence проверяется на реальном CI.
- [Upstream убрал публичные образы и binaries] → официальный signed source commit и checksum; public Go builder manifest проверен read-only до CI, никакого fork/latest или обновления production.
- [Перенос проверки теряет случай] → компактная карта старый случай → новый case ID и запуск обоих наборов до удаления helper.

## Migration Plan

Local: pure guards/type/lint и OpenSpec. Далее draft PR с реальными CI services, tests и cleanup logs на точном SHA; обычный merge feature/169 в staging и приёмка фактического образа/здоровья. Разрешение на staging уже действует; main/production только по отдельному прямому поручению владельца. Откат CI — возврат изменения workflow и тестовой команды через обычную ветку задачи.

## Текущий native/runtime scope после 259f

Сохраняются уникальные реальные SQL/Decimal/locks/rollback/idempotency/ACL/HTTP/storage vectors и exact protected baseline, names/case IDs учитываются вместо квоты. Existing runtime испытывает ту же Alpine OCI runtime-конфигурацию и layers, которые №170 затем публикует: host .next/node_modules/ABI не копируются в runtime. Основной owned web3100 стартует стандартным production CMD с migrate deploy; отдельная host double-migration убирается. Fault child3101 запускает literal node apps/web/server.js без migration ТОЛЬКО для fault и подключается к тому же owned PG/network unique `ci_fault_<run>_<attempt>` NOSUPERUSER LOGIN role с CONNECTION LIMIT5/minimal plugin DML/User SELECT. Real instrumentation/register/syncPlugins должны завершиться и health дать200 до fault. Затем только fault role CONNECTION LIMIT0 и terminate exact role/datname=pero_ci sessions воспроизводят POSTBOOT outage: прежние health503/session null/my307 assertions сохраняются. Main role, PG/S3 и protected data не меняются; PG stop/reset, mocks/NEXT_PHASE bypass запрещены. Before DB/S3 — repo/SHA/run/attempt/image/config/diff_ids/BUILD_ID/ownership guards. Finally/always удаляют обе web children/processes, MinIO/images и подтверждают GitHub PG/network cleanup при success/failure/cancel. Старые recovery/reset/archive workflows не становятся recurring CI. Новые cases/retirement доказаны только после ordinary CI/Stage.
