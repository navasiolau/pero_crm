# Статус correction-релиза — 01.10.2026

Владелец одобрил выпуск `product-engineering-pay` как части корректировки, описанной в [общем manifest](../../../docs/CRM_APPROVED_RELEASE_CORRECTION_20261001.md). Это supersedes исторический HOLD только для этой коррекции; старые статусы задач ниже не переписываются.

Source local/staging документы остаются исходной историей и не меняются. Для этой корректировки migration нужна только для schema/history compatibility: она не включает новый ручной фонд, UI ставок Work или расчёт от весов. Новые ставки инженерной и монтажной фаз задаются прямым `Product.expectedPrice` механизмом из `product-percentage-pay`. Предыдущие source UI/settlement записи не трактуются как acceptance новых процентных выплат или split. Полный локальный suite correction-кандидата root завершил PASS; counts, byte-equality comparison с принятым staging source `a899` и migration list записаны в общем manifest.

Новых QA-записей, staging acceptance или production checks для correction-кандидата не заявляется. Main push ожидает root. Production SQL/SSH/native write checks не выполнялись; production result acceptance остаётся владельцу. Незавершённая задача release/promotion в исходном checklist не отмечается выполненной.
