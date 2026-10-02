# Proposal

## Why

№25 завершает единую адаптивную карточку изделия по §3.1, сохраняя реальные действия №17–24.

## What Changes

Существующие компоненты и доменные механизмы завершают соответствующий пункт плана без нового pay/UI subsystem. Реальные поля/действия, прежние ACL/история сохраняются.

## Capabilities

### New Capabilities

- $name: №25 завершает единую адаптивную карточку изделия по §3.1, сохраняя реальные действия №17–24.

### Modified Capabilities

Нет.

## Impact

Card/domain/web/bot consumers соответствующей задачи; без внешних dependencies и production изменений.

## Delivery Context

Planning-only provisionalf33f574 вmodernization-24. Root перенесёт только artifacts в реальный fresh task tree/feature25 либо26 после предыдущего ordinarymerge; actualstage gate сохраняется. Owner approval throughstaging уже дан. Essentialtests/build/smallsmoke сейчас, comprehensivevisual20–26 после26 unchecked.

## Actual Branch Context

Root после fresh fetch создал feature/25 от originf33f574 в modernization-25. Прежняя planning в24 была provisional; теперь это фактическая локальная ветка. Независимая параллельная localimplementation разрешена владельцем. Перед интеграцией root ordinarymerge свежего предшествующего staging (для25 после24, для26 после25), сверяет source/contracts и проходит basicactualstage gate. Fullvisual после26 остаётся unchecked; sourceworkers changes не затронуты.

## Final Essential Local25

Actualfeature25 ordinaryfresh24merged HEAD82a19f1, preservedcode/no conflicts. Root828unit/type/lint/BUILD25PASS. Card-onlyhistorypayload removed, DB/domain/AdminChangeLog preserved. Integration25afteractual24acceptance; actual25stage pending, finalvisualafter26unchecked.
