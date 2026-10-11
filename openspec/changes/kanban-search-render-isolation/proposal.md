# Proposal

## Why

Actual available-PC baseline141 показал10 000/8 740 вызовов тела неизменных карточек проектов/изделий на20клавиш и profiling root p95≈42мс. Immediate search draft обновляет доску, повторяет grouping/callbacks и пересоздаёт sensor options, хотя rows не изменились.

## What Changes

- Стабильные grouping arrays/column props/card callbacks и PointerSensor options в двух глобальных канбанах; shallow memo для колонок и draggable bodies, без custom comparator или откладывания controlled input.
- Существующий list controller предоставит стабильный getter актуального query для события открытия изделия, чтобы cached callback сохранял свежий returnTo после фильтров/reset/back/CAS/pending RSC.
- Preservation/real rendering regressions и matched before/after profiler по protocol141, source/asset/role guards и независимое review.

## Capabilities

### New Capabilities

Нет: функциональность поиска, навигации, прав и сохранения данных не меняется.

### Modified Capabilities

Нет spec-level behavior changes; skip_specs true для pure rendering refactor. Действующие persistent-list-state, kanban-identity-search-focus и project-product-card-navigation requirements сохраняются. Последние два живут в change deltas, canonical specs отсутствуют; duplicate spec не создаётся.

## Impact

Production scope: apps/web/src/app/(app)/projects/kanban-board.tsx; apps/web/src/app/(app)/products/products-kanban.tsx; apps/web/src/lib/list-params.tsx. Tests/evidence/OpenSpec только task142; own branch bugfix/142 freshcd38. No deps/lock/schema/API/server/CSS changes, noRole128/ready145 WIP copies. After root integrations127/128/145 — joint regression, source parent changes require compatible or renewed baseline. Main/production запрещены; owner разрешил необходимые коммиты, local candidate только после code review; staging writes only separately reviewedprotocol/rootwindow. SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md, STOP on mismatch.
