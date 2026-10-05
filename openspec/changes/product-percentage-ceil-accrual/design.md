# Design

## Context

Direct completion создаёт версии3 и ROUND_HALF_UP(2); SQL CHECK фиксирует amount=ROUND(sourceFundExact,2). Доступен Decimal(12,2), sourceFundExact Decimal(18,6). Старые версии и FX retry frozen.

## Goals / Non-Goals

**Goals:** UI/server одна точная формула и новые целые начисления.
**Non-Goals:** пересчёт финансовой истории, общий formatter денег, другие зарплатные схемы.

## Decisions

Общий чистый helper считает BigInt: цена в сотых × ставка в сотых процента × количество (только ASSEMBLY/INSTALLATION). Делитель для целых BYN1000000; потолок положительного рационального результата без промежуточных копеек. Helper отдаёт exact до6знаков и amount с .00, валидирует округлённую сумму<=9999999999.99. Использовать его в direct-completion, query DRAFT и preview версии4. Для отсутствующих данных UI возвращаетnull; серверные проверки получателя/цены сохраняются. Новые snapshots и audit пишут version4, types/reader знают1|2|3|4. История сохраняет прежние branches и значения.

Forward migration добавляет только ветку4 в version_shape CHECK; формулы баз и immutable-trigger прежние, amount=CEIL(sourceFundExact), BYN/projectamount совпадают с amount. Старые файлы миграций не изменять.

## Risks / Trade-offs

Переполнение после потолка → проверять округлённый итог до записи. Малый положительный результат →1BYN, явный0→0. Незавершённые прежние изделия → новые будущие completion получают4; существующие first-completion исключают дубль.

## Migration Plan

Local/staging existing DB guarded; проверки в outerROLLBACK с fingerprint. Schema миграция сохраняется штатно, тестовые данные откатываются. До production отдельное указание владельца, один временный dump и изолированная restore-проверка; restic не читать. Старый binary reader версии4 откатывать нельзя: при сбое исправление вперёд или совместимый reader без изменения истории.

