# Design

## Context
Задача33 использует существующие ProductInlineProvider/CAS и Client create/update actions. Actor37 владеет live ProductHeader;33 размещает его над названием. Actor34 меняет upload caption,36 — процентные строки. Их изменения сохраняются обычными merge root.

## Goals / Non-Goals
Изолировать cover от высоты left column, показывать выбранный Client, переиспользовать клиентский CRUD. Не менять статусы, процентную оплату, upload policies или Project/Client CRUD права.

## Decisions
- Desktop cover: отдельная viewport-height grid area с self-start и независимой высотой; без растягивания по left-content и без обрезания left column. Mobile после контактов.
- Header37 получает actorUserId/backHref и содержит номер/status/back. ProductInlineTitle оставляет единственный editable title.
- Shared Client dialog вызывается из справочника и Product. Новый клиент создаётся штатным action; selection использует существующий project.clientId CAS. При конфликте создания/выбора новый клиент остаётся реальным, но выбор не подменяется автоматически.
- Product phone/project.address варианты исключаются из closed patch DTO; currentClient contacts возвращаются actual server DTO, не из Project.address и не из несохранённого draft.
- Документы получают один заголовок/тонкую рамку; внутренняя two-column container640 логика сохраняется.

## Risks / Trade-offs
Новый клиент отсутствует в старом списке → использовать actual created/client-bind DTO; не выдавать сырую форму за сохранённый контакт. Незавершённый CAS → сохранить прежние confirmed контакты и draft. Совместимость прежних Product contact payload → явный отказ до write; Project/Client пути не закрываются.

## Migration Plan
Без миграции и новых dependencies. Pure/runtime-targeted tests, tsc/lint; root Git/build/deploy. Широкая визуальная приёмка после33–38, БД/runtime/SSH/restic/dumps вне работы агента.
