# Proposal

## Why

№26 скрывает первоначальные цены и закрывает ordinary writes; первое явное expectedPrice нового eligible изделия фиксируется без backfill истории.

## What Changes

Существующие компоненты и доменные механизмы завершают соответствующий пункт плана без нового pay/UI subsystem. Реальные поля/действия, прежние ACL/история сохраняются.

## Capabilities

### New Capabilities

- $name: №26 скрывает первоначальные цены и закрывает ordinary writes; первое явное expectedPrice нового eligible изделия фиксируется без backfill истории.

### Modified Capabilities

Нет.

## Impact

Card/domain/web/bot consumers соответствующей задачи; без внешних dependencies и production изменений.

## Delivery Context

Planning-only provisionalf33f574 вmodernization-24. Root перенесёт только artifacts в реальный fresh task tree/feature25 либо26 после предыдущего ordinarymerge; actualstage gate сохраняется. Owner approval throughstaging уже дан. Essentialtests/build/smallsmoke сейчас, comprehensivevisual20–26 после26 unchecked.

## Actual Branch Context

Root после fresh fetch создал feature/26 от originf33f574 в modernization-26. Прежняя planning в24 была provisional; теперь это фактическая локальная ветка. Независимая параллельная localimplementation разрешена владельцем. Перед интеграцией root ordinarymerge свежего предшествующего staging (для25 после24, для26 после25), сверяет source/contracts и проходит basicactualstage gate. Fullvisual после26 остаётся unchecked; sourceworkers changes не затронуты.

## Final Essential Context

Actual26HEAD110dda81 ordinary25merge resolvedkeep25layout/hideinitial, root835web/bot19/type/lint/BUILD26PASS/migration1financialpreserved/native5all43rollback. Actualstage25/26 pending; comprehensivevisualafter26unchecked/mainnotauthorized. Task32loginaccessblocker recorded separately inevidence, nofakeXLSX.
