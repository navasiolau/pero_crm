# Статус correction-релиза — 01.10.2026

Владелец одобрил `product-cover-layout` как часть корректировки, описанной в [общем manifest](../../../docs/CRM_APPROVED_RELEASE_CORRECTION_20261001.md). Это supersedes исторический HOLD только для этой коррекции; принятые source receipts и их ограничения сохранены.

Source `a899e8e` прошёл local и qualified read-only staging UI review на существующих изображениях; публичный receipt указан в [acceptance](acceptance.md). Эти проверки подтвердили макет, WebP preview и fullscreen. Picker прошёл только open/cancel; cover replacement, upload и live file mutation **не выполнялись**.

Root подтвердил полные локальные проверки correction-кандидата PASS и побайтовое совпадение кода/UI с принятым staging source `a899`; результаты приведены в общем manifest. Нового staging acceptance и production checks не было. Main push ожидает root; production result acceptance остаётся владельцу. Production SQL/SSH/native write checks не выполнялись; live cover replacement/upload не считаются проверенными.
