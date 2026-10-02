# Design

## Context

Project хранит currency, createdAt, initialPrice и три услуги; Product хранит expectedPrice, скрытый initialPrice и quantity. Текущая pricing projection использует PostgreSQL txid_current() как pricingVersion; физического столбца в fresh02d нет. Официальный API НБ РБ проверен HTTP200: RUB/2024-01-05, Cur_ID456, rate3.4998/scale100; каталог даёт validity2021-07-09..2050-01-01. Страница APIHelp недоступна; неофициальные источники не используются.

## Goals / Non-Goals

**Goals:** воспроизводимый signed plan и root-controlled local/staging apply с проверкой цены/даты/FX и неизменяемых фактов.
**Non-Goals:** production DB, fallback FX, распознавание legacy валюты по цифрам/адресам, исторические пересчёты, schema migration, отключение triggers, фальшивый production report.

## Decisions

- Выбор только currency!=BYN. Нормализованный Project.createdAt используется Intl Europe/Moscow; дата изделия не участвует. Для pre-BYN дат до2016-07-01 STOP с явным кодом, без скрытой деноминации.
- Fetch официального catalog один раз; единственная metadata запись abbreviation/date validity должна совпасть с Cur_ID/scale archived rate. Сохраняются raw rate, raw matching metadata, исходные URLs и SHA; полный raw catalog отдельно в результате fetch для архива root.
- Decimal(amount)×OfficialRate÷Scale, unit/услуги round-half-up2. Product line = rounded unit×qty. Скрытые initial цены сохраняют null и конвертируются отдельными полями, только если DB guards разрешают.
- Root inventory получает выбранные rows и fingerprints всех public tables, включая все Prisma models, дополнительные legacy tables и `_prisma_migrations`. Apply принимает подписанный исходный manifest и небольшой sealed rates/planHash envelope; полный plan/report recomputed из источника, не дублирует крупные rows в transport. Row locks/expected values и полный unchanged fingerprint внутри Serializable transaction, без вызова app writers.
- Root runtime выявил между шагами только штатные изменения ApiToken.lastUsedAt от bot GET до любой записи цен. Новый подписанный manifest version2/profile исключает только это поле из ApiToken; все остальные поля/counts и финансовые модели остаются строгими. Старые manifests отвергаются, не пересчитываются.
- Allowlist: Project currency/initial/services/updatedAt; Product expected/initial/updatedAt. Quantity/прочие колонки и остальные модели неизменны. Реальный transaction txid отражает существующий pricingVersion; новый физический столбец не добавляется (root уточнил контракт).
- Replay допускается только при exact after-state всех выбранных rows и неизменных прочих фактах; смешанное/stale/unknown состояние STOP. Никаких partial conversions.

## Risks / Trade-offs

- [Append-only/currency triggers] → не обходить, транзакция откатывается и root получает STOP.
- [Одновременные app writes] → exact snapshots/fingerprints и Serializable конфликт; root повторяет inventory после анализа.
- [Большой manifest] → строгие bounds транспорта, STOP вместо расширения/обрезки scope.

## Migration Plan

Миграций нет. Сначала pure tests и source review. Root получает real local/staging inventory, official FX и подписанный plan, выполняет apply через existing qaTransport с image/hostname/DB guards. Production №32 — ручной один файл только из actual app source, не SQL/read/write target этого runner.

## Verification

14/14 focused unit tests PASS: Decimal/UTC-Moscow/scale/null/unit-before-qty, invalid/duplicate/missing FX, signed tampering, target rejection, atomic trigger rollback, other-fact changes и idempotent replay; app-only report не придумывает null/qty/date для unavailable. Packet test проверяет existing outer inspect gate и отдельный priceOperation. Новый operational profile допускает только lastUsedAt, отвергает изменение других полей/counts/финансов и old signed manifests. TypeScript PASS, ESLint 0 errors/0 warnings; source-only проверки субагента без DB. Неиспользованный Python generator удалён по review; реальный workbook создаёт root через Spreadsheets/artifact JS. Root сообщил actual production app export и workbook; их evidence ведёт root. Actual test apply повторяется root с новым profile/inventory.
