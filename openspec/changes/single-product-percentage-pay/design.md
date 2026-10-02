# Design

## Context

Detached planning f33f574 staging21; root refresh/feature23 после предыдущего merge, integration23 после basic22stage. Core уже существует в server/product-percentage-pay/core.ts с ProductPercentageConfig/Participant/Completion/Share, unique productId_kind и frozen currencies. products/status-core.ts является transaction boundary; product-stage-pay/core.ts содержит альтернативные инженерные funds writers. Schema имеет Product.engineerId, существующие версии completion без quantity semantics; legacy Payroll имеет taskId/workId. Не создавать второй pay subsystem.

## Goals / Non-Goals

**Goals:** новая single-recipient version2 база и source-grounded legacy guard.

**Non-Goals:** перерасчёт истории, новая FX policy, stageproject payouts, assembly enum/UI до24, initialPrice26, megаQA/production.

## Decisions

1. Additive mounterId FK/nullable и version2 snapshot поля unitPrice/quantity; новые version2 используют existing Decimal/rounding helpers, BYN policy16. Version1 default/history остаются прежними, без quantity backfill. Config хранит одну rate; engineerId authoritative вместо participant selector. Existing one-share модель используется для immutable final recipient, не для новой настройки долей.
2. Existing status transaction/globallock получает current fields и завершает достигнутые стадии один раз по unique constraint. Null rate→SKIPPED_ONCE; explicitzero→нулевой completion/share без Payroll; positive requires price≥0 и activeeligible actor. Active engineer для ENGINEERING, active MOUNTER для INSTALLATION; manager-confirmed DONE; jump закрывает thresholds, reclamation/rollback не отменяют заработанное. Outbox/audit внутри tx, внешняя доставка послеcommit.
3. Новый configure/inline field путь с настоящим expectedValue/revision и текущими правами; послеcompletion edits текущих назначений/rates разрешены, но snapshot не меняется. Retire NEW engineering pool create/config/settle writers в product-stage-pay/core/service/actions и UI; старые frozen settlement/PENDINGFX retry сохраняют происхождение, не открывают новое фондовое начисление.
4. Migration legacy markers только NOT EXISTS productId_kind с доказанным threshold history/pool settlement или actual projectId↔product relationship и Project PERCENT_PROJECT. Project payroll evidence означает legacy covered/no-new-pay защиту, НЕ распределение суммы проекта по изделиям. Прямой старый product completion источник имеет приоритет; unknown history не синтезировать. Однозначное назначение переносимо, несколько участников требуют явного current recipient, не arbitrary collapse.
5. Review LEGACY works минимально переиспользует existing reviewedLegacyWorkIds и реальные Work/Task/Payroll relations. Before newpositive installment (и reusable24assembly) каждый оплаченный relevant LEGACY Work требует явной covered/independent классификации. Covered исключает повторное начисление за тот же труд; independent остаётся отдельным piecework. Нельзя менять paid work classification/amount задним числом; paidTaskId query обязателен вместе с directworkId. Не распознавать назначение работы по имени.
6. Product rates/assignees UI используют existing inline transport/rights; previews умножают unitPrice×qty и не показывают legacy projecttotal как productpaid. Не дополнять25 layout или26 snapshot. Project stage writer не порождает новых engineering Payroll.

## Risks / Trade-offs

- [Legacy evidence incomplete] → ограниченный отказ затронутой positive операции и явный review, не fabricated marker/FX.
- [Migration исторических markers] → NOT EXISTS, настоящие FK/history связи, repeat-safe; никаких paidamount allocations.
- [Frozen old operation] → отдельная version1 retry semantics, old currencies protected.

## Migration Plan

Additive compatible migration root выполняет на existinglocal/staging без dumps/restic/newDB/reset/seed; агент не запускает DB. RED→GREEN domain cases, build и small functional smoke. Root ordinary merge23 после22accepted, actualimage/health/smoke. Comprehensive visual/pixel всех6sizes после26 unchecked; main/prod excluded. SAFETY guard mismatch STOP.

## Conservative Legacy Work Review

Config.workReview — nullable Json array с exactworkId и classification COVERED|INDEPENDENT. Только реальные Payroll.workId либо Payroll.taskId→Task.workId подтверждают оплату; relevant works требуют явного review. COVERED+ужеPAID защищает ВЕСЬ этап как LEGACY_PROTECTED: никакого нового процента или выдуманной paidamount. INDEPENDENT сохраняет самостоятельный PIECE и допускает новый процент. COVERED+UNPAID подавляет будущий PIECE только через validated review read в completion writer, без нового глобального поляWork и без переписывания старогоPayroll. Review immutable послеcompletion; actor/date/revision фиксируются ChangeLog атомарно.

Root уже создал реальную feature/23 от freshstagef33f574; перед интеграцией required ordinarymerge22 refresh. Это локальная authorization, не утверждение staging23 acceptance.

## Actual Integration Base

Root feature23 ordinarily refreshed22 to46d7392 with preserved work and resolved23UI/core conflicts. Actual22image/native basicacceptance complete; essential23full801/build/native7groups completed, staging23 pending. No hostedconcurrency claim; finalvisual after26unchecked.
