# Design: rate-rules

## Решение

1. Миграция `..._product_percentage_nonempty_rates`: `UPDATE ProductPercentageConfig SET ratePercent=0 WHERE NULL`; `OrgSetting` JSON `productPercentageDefaults`: замена `:null` на `:"0.00"`. Без пересоздания начислений.
2. Схемы: `defaultRatesSchema` — non-null `0..15, 2dp`; `productPercentagePatchSchema.ratePercent` — non-null string обе стороны; `parse` контроллера и `submit` настроек отклоняют пустое; `createProductCore` маппит отсутствующее в `'0'`; `EMPTY_DEFAULTS` остаётся null-совместимым только для чтения (форма показывает '0').
3. `patch-core`: выбор `status`; DONE → forbidden обеим полям. После обновления конфига: если поле `ratePercent` и есть SETTLED-completion и статус не DONE → `adjustSettledPercentage` (пересчёт v4, обновление снимка/доли, дельта-entry текущим месяцем при delta≠0, ChangeLog `percentage.rateAdjust`, `notifyPerson` получателю).
4. `captureProductPercentageCompletion`: существующий SKIPPED_ONCE + положительная ставка + eligible + не legacy → `settleSkippedPercentage` (обновление завершения в SETTLED, доля, entry как при первичном).
5. Панель: `previewRate` из валидного черновика, иначе baseline.
6. Тесты: backfill-преобразование (unit на чистой функции? миграция SQL — проверяется migrate status + локальный ROLLBACK-прогон), патч-генезис (DONE-reject, adjust-delta, skipped-settle через test-транзакции), UI-превью от черновика, запрет пустого.

## Риски

- Дельты меняют месячные итоги задним числом смысловым (запись новым месяцем, история не переписывается) — принято.
- Начисление пропущенного при следующем переходе может удивить суммой — покрыто уведомлением как обычное начисление.
