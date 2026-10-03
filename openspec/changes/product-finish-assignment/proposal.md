# Proposal
## Why
Каталог72 готов, но выбранные отделки ещё не сохраняются в обычной карточке изделия. Требуется именованная спецификация со снимками, защищённая от незаметных изменений каталога.
## What Changes
- Product Finish assignments по текстовым элементам (корпус/фасады/столешница/custom), без BOM/деталей/CAD/3D.
- Stable UUID child rows, Product.finishRevision и closed partial mutations с UUID receipts/CAS.
- Snapshot kind/name/code/color/catalogrevision; catalogedit/deactivation не переписывают существующие строки.
- Действующие management/technicalDESIGN права и liveparent/child сохраняются; UI pending/drafts/error не теряются при RSC.
## Capabilities
### New Capabilities
- `product-finish-assignment`: сохранённые снимки покрытия элементов изделия.
### Modified Capabilities
Нет.
## Impact
Additivemigration20261003130000_product_finish_assignment, core/actions/readprojection, normalProductsection+cachedcontrollers. NoPrice/qty/BYN/immutablepay changes; media74nullable fields будутдобавлены отдельно безfakebackfill.
