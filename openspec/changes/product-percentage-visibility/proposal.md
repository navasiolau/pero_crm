# Proposal

## Why

Полевые специалисты (WORKER/MOUNTER/ENGINEER) сейчас либо не видят сумму до назначения исполнителя, либо видят процентные ставки. Владелец утвердил матрицу: сумма % видна ДО назначения (прогноз по ставке), ставка обязательна из настроек, поле видит только СВОЮ сумму в BYN и имена назначенных, свои и чужие % не видит вообще; менеджеры MANAGER/PROCUREMENT видят всё как раньше.

## What Changes

- Прогноз суммы DRAFT считается через `calculateWholeProductPercentage` даже при `assigneeId==null` (нужны только `rate!=null` и `price!=null`).
- Не-финансы (не MANAGER/PROCUREMENT): `members` только своя строка, `ratePercent`/`unitPrice`/`productTotal`/чужие суммы занулены, имена исполнителей (`assignee`) оставлены; `total`/прогноз виден как своя сумма в BYN.
- Карточка изделия (`SinglePercentageRow`): строка своей суммы показывается всегда, включая DRAFT без назначенного (как прогноз); `%` рендерится только при `canViewAll`.
- Новые изделия получают ставки из дефолтов; при `rate==null` менеджеру показывается понятная подсветка.
- Точность ставок настроек: до 2 знаков после точки (например 1.25), нормализация `toFixed(2)`, старые снапшоты с 1 знаком валидны; форма настроек использует общий `PercentageRateInput` (стрелки 0.5 + ручной ввод до 2 знаков).
- Зависимость от параллельной ветки feature/81 (переименование enum DELIVERY → STORAGE): новый код пишется против имени STORAGE; в данной ветке enum ещё DELIVERY, поэтому где нужен статус доставки используется строковый литерал "STORAGE" с комментарием; мерж идёт после feature/81.

## Capabilities

### New Capabilities

- `product-percentage-visibility`: видимость процентных сумм без раскрытия ставок полевым ролям, прогноз до назначения, обязательная ставка из настроек, точность 2 знака и шаг 0.5 в общих компонентах.

### Modified Capabilities

Нет изменений основных спецификаций; связанные действующие changes сохраняют свою историю.

## Impact

- `server/product-percentage-pay/queries.ts` (`getProductPercentageView`), `lib/product-percentage-ceil.ts` (без изменений формулы), `app/(app)/products/[id]/product-percentage-panel.tsx`, `server/products/core.ts` (проверка создания конфигов), `server/product-percentage-defaults/contracts.ts`, `app/(app)/settings/product-percentages/percentage-defaults-form.tsx`, общий `components/percentage-rate-input.tsx` (без изменений логики).
- API/схема БД не меняются; права MANAGER/PROCUREMENT сохраняются; ADMIN/DIRECTOR входят в MANAGER_ROLES и видят всё.
