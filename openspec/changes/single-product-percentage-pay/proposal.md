# Proposal

## Why

№23 реализует простую оплату инженеру и монтажнику по §5.1: один назначенный получатель и одна ставка каждого этапа. Новые начисления учитывают количество изделий, сохраняя существующую оплату и исторические снимки.

## What Changes

- Product.engineerId и mounterId — единственные получатели ENGINEERING/INSTALLATION, одна ставка на этап, без новых participants/shares config/pools.
- Новые version2 snapshots: unitPrice × quantity × rate в BYN; atomic status/completion/единственная share/payroll.
- Known legacy version1/history/pools сохраняются; null-rate SKIPPED_ONCE, zero-price без Payroll, без late backpay и project-stage начислений.
- Явный review оплаченных LEGACY Works через Payroll.taskId→Task.workId перед новой положительной оплатой; никакой name heuristic или двойной оплаты.

## Capabilities

### New Capabilities

- `single-product-percentage-pay`: одиночные инженерные/монтажные начисления нового формата и совместимость истории.

### Modified Capabilities

Нет. Existing engineer access и объединение ролей сохраняются.

## Impact

Prisma additive поля/version metadata, product-percentage-pay core/actions/queries, products status/core/patch и percentage UI, product-stage-pay engineering pool writers, project-stage legacy compatibility. Нет FX/пересчёта старых snapshots/qty backfill. №24 добавит ASSEMBLY поверх этого же core; №25/26 и production исключены.

## Delivery Context

Planning-only detached f33f574 accepted staging21 base; root создаёт feature/23 от fresh preceding merge, integration по порядку после basic22 acceptance. Owner разрешил весь план через staging; local domain/tests/build/small smoke сейчас, comprehensive visual после26 unchecked. Restic/dumps/DB reset/newDB/infra запрещены.

## Actual Integration Base

Root feature23 ordinarily refreshed22 to46d7392 with preserved work and resolved23UI/core conflicts. Actual22image/native basicacceptance complete; essential23full801/build/native7groups completed, staging23 pending. No hostedconcurrency claim; finalvisual after26unchecked.
