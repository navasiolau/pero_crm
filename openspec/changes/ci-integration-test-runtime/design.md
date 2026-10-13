# Design

## Context

Существующий `test` job уже устанавливает pnpm/Node 22, генерирует Prisma, проверяет lint/types/tests и собирает Next.js. Production Compose использует PostgreSQL 17. Инвентаризация MinIO фиксирует `RELEASE.2025-09-07T16-13-09Z`; официальный образ имеет CMD `minio`, поэтому для сервера нужны аргументы, которых нет у GitHub `services`.

## Goals / Non-Goals

**Goals:** один общий runtime и настоящие DB/S3 контракты; минимальный дополнительный код; подтверждение удаления стенда.

**Non-Goals:** новая функция CRM, QA-framework, смена зависимостей, рабочие БД/S3, PVE/VPS, main/production.

## Decisions

1. PostgreSQL `postgres:17-alpine` — штатный service test job, `127.0.0.1:55432/pero_ci`; данные в tmpfs. GitHub владеет удалением service/network, повторного удаления нет.
2. MinIO `minio/minio:RELEASE.2025-09-07T16-13-09Z` — scoped `docker run` на сети job, `127.0.0.1:59000`, tmpfs `/data`, labels repo/run/attempt/purpose. Root согласовал этот запуск. Custom wrapper image и обход поля options не нужны.
3. `assertCiRuntimeTarget()` возвращает validated `runId`, `attempt`, `databaseUrl`, `baseUrl`, `s3`, `authSecret`; фикстуры вызывают его до создания клиентов. Runner дополнительно сверяет metadata Docker, отсутствие env-файлов и точную принадлежность ресурсов до миграций. Только `prisma migrate deploy`, без seed/reset/dump.
4. Единственная имеющаяся сборка используется через Next production на `http://127.0.0.1:3100`; `tsx --test --test-concurrency=1 tests/integration/*.test.ts`. Фикстуры и случаи принадлежат профильным авторам; ID и protected baseline общие.
5. `finally` и шаг `always()` завершают owned web и удаляют только owned MinIO. Cleanup повторяем, guard при несоответствии останавливает удаление. Журнал сообщает отсутствие контейнера и постоянного data volume. Системный `Stop containers` служит доказательством удаления PG/network, including cancelled run.

## Risks / Trade-offs

- [Отмена до обычного finally] → дополнительный `always()` cleanup и уничтожение hosted runner стандартным lifecycle; evidence проверяется на реальном CI.
- [Отличие официального tag от локального бинарника] → проверка доступности pinned образа в пилотном PR, без обновления production.
- [Перенос проверки теряет случай] → компактная карта старый случай → новый case ID и запуск обоих наборов до удаления helper.

## Migration Plan

Local: pure guards/type/lint и OpenSpec. Далее draft PR с реальными CI services, tests и cleanup logs на точном SHA; обычный merge feature/169 в staging и приёмка фактического образа/здоровья. Разрешение на staging уже действует; main/production только по отдельному прямому поручению владельца. Откат CI — возврат изменения workflow и тестовой команды через обычную ветку задачи.
