# Proposal

## Why

На actual staging применён исходный файл `20261006180000_product_percentage_nonempty_rates` SHA d094…, а принятый Git содержит изменённый SQL SHA277540… с дополнительным INSERT. Это смысловое изменение уже применённой миграции; №167 отдельно одобрен владельцем для исправления local→staging без переписывания ledger или исторических денежных фактов.

## What Changes

- Восстановить старый файл BYTE-EXACT из Git blob9759270d3116248cf09eae309f8c8cacdaf6b808/commit2d50eb510893d781d47afdfed97333168764c614, checksum d0948074ff79ac17f365490440c851650550910a6909d952ca278464b3f80a62.
- Добавить новую INSERT-only миграцию для каждой отсутствующей пары Product/ENGINEERING|ASSEMBLY|INSTALLATION, включая частично настроенные и soft-deleted изделия. Создаются0/revision1/empty reviewedLegacyWorkIds; существующие конфиги и OrgSetting/история не меняются.
- Согласованная native проверка на существующей local5433: controlled rollback-only cohorts, source composition, expected missing pairs, second-run0, полная сохранность исходных configs/participants/completions/adjustments/payroll/FX и ledger. Actual existing local/stage prehistories квалифицируются отдельно.
- Локальная проверка → independent review → parent normal staging merge/CI → точная staging-приёмка/одна root-approved миграция. Main/production запрещены.

## Capabilities

### New Capabilities
- `immutable-percentage-migration-backfill`: неизменяемое исходное содержание миграции и отдельное идемпотентное заполнение отсутствующих процентных конфигураций без изменений существующих данных.

### Modified Capabilities
Нет изменений UI/API/ролей/формул. `crm-autodeploy` watcher не меняется. Dockerfile CMD запускает prisma migrate deploy на startup: root доказывает actual command override либо создаёт PRE/history/protected fingerprint/lease ДО push и считает один startup approved migration execution; duplicate manual deploy не выполняется. Прочитаны main specs и active процентные changes; старые обязательства/null/zero/frozen сохраняются.

## Impact

Own worktree `D:/Projects/pero_crm_worktrees/improvements-167`, branchbugfix/167 от freshorigin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929. Точно2 SQL source paths,3 meaningful test/protocol paths и own OpenSpec. Schema/client/lock/dependency версии не меняются. Восстановление/повтор старых двух UPDATE/ledger rewrite/resolve/reset/seed/newDB/dump/restic/production не входят. SAFETY `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`: STOP mismatch. Human explicit «Добавить и выполнить №167», commit permission всего плана получена; native/DDL отдельные protocol/root once gates.
