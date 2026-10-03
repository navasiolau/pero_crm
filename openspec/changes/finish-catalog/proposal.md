# Proposal
## Why
Для будущих Product snapshots73 нужен независимый стабильный каталог эмалей, шпона и покрытий без fakeProject/CAD/BOM. Сейчас справочника нет.
## What Changes
- Finish catalog: стабильный UUID, тип Эмаль/Шпон/Покрытие, название/код/цвет, активность; код уникален внутри типа после канонизации.
- Управление ADMIN/DIRECTOR/MANAGER/PROCUREMENT, операционные audiencereadonly по существующим OFFICE/FIELD grants; ACCOUNTANTfinance-only не получает доступ.
- Создание/правки с CAS revision и аудитом; reversibledeactivation вместо физического удаления.
- Product assignments/snapshots73 и protectedsamplemedia74 отдельны; no fakeFile/Project/Storage здесь.
## Capabilities
### New Capabilities
- `finish-catalog`: независимый справочник вариантов отделки.
### Modified Capabilities
Нет.
## Impact
Finish schema/migration20261003090000_finish_catalog, core/actions/queries, /finishes UI и узкий nav/operationalACL. Без финансовых, Productassignment или storage изменений.
