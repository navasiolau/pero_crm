# Статус correction-релиза — 01.10.2026

Владелец одобрил `product-percentage-pay` как часть корректировки, описанной в [общем manifest](../../../docs/CRM_APPROVED_RELEASE_CORRECTION_20261001.md). Это supersedes исторический HOLD только для этой коррекции; source acceptance и старострочные ограничения ниже остаются без переписывания.

Исходный staging source `080d9d9` проверялся read-only по существующим данным. Положительное live earning/accrual и прямой live split **NOT VERIFIED**. Preservation сверка имела зафиксированное расхождение от отдельного изменения существующим пользователем; данные не восстанавливали и строки не исключали. Unit/DI или UI evidence не подменяют live начисление.

Полный локальный suite correction-кандидата root завершил PASS; counts и byte-equality comparison с принятым staging source `a899` записаны в общем manifest. Для correction-кандидата не заявлены новые QA-записи или staging/production проверки. Main push ожидает root; production result acceptance остаётся владельцу. Production SQL/SSH/native write checks не выполнялись, а позитивное начисление/разделение остаются непроверенными.
