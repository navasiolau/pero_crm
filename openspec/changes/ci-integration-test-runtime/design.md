# Design

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
