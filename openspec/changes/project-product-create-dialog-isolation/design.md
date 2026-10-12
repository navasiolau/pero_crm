# Design

## Context

Состояния title/kind/quantity/price/description/engineerId и общий create/status useTransition находились в ProductsTab. Перенос ограничен двумя production-файлами; существующие ProductQuantityInput, SearchableSelect и UI Dialog переиспользуются.

## Goals / Non-Goals

Цель:0 рендеров неизменившихся карточек/колонок/родителя при вводе в диалог, без изменения поведения формы и миниканбана. Вне задачи: CSS, ACL, status API, сервер, схема, DnD/memo/sensor refactor и исправление существующих reset/late-response особенностей.

## Decisions

### State ownership

CreateProductDialog постоянно смонтирован. Все6 drafts, parsed price/quantity, canCreate и create transition локальны. Parent управляет open и refresh после подтверждённого create; его status pending передаётся в busy union. Новый callback, возвращающий каждое изменение состояния формы в parent, не нужен.

### Lifecycle preservation

Footer «Отмена» вызывает controlled close напрямую и сохраняет drafts. Dialog onOpenChange(false), включая X/Escape, очищает все6. Success закрывает и сбрасывает title/kind/price/quantity/description, сохраняя engineerId. Error сохраняет draft. Поздний error сохраняет текущий изменённый draft; поздний success по-прежнему закрывает заново открытый диалог. Не добавляются generation/abort/retry или reset effect на любую смену open.

### Bounded verification

Старый400key baseline082bd привязан к d121 и неизменяем. Для текущего c650 выполняется один небольшой affected component harness: actual ProductsTab/Dialog и20 карточек, только Next transport в памяти; перед source comparison original parent читается одним git show. Shared existing kanban-render-observer получает только3 mini body bindings без callback; счётчики исполняются внутри настоящих функций.

Desktop1440×900 и mobile390×844/360×800, DPR1, одинаковые data/CSS/Arial,sans-serif, closed/open Dialog →6 before/after пар. Caret маскируется одинаково для снимков; RGBA и geometry должны совпасть точно, PNG hashes служат целостности артефактов. Реальные title/description/price/quantity input events сравнивают body counts до и после idle. Validation/error/cancel/X/reopen/success/late ACK проверяются в том же настоящем браузере. No DB/full Next, memory action не заменяет staging create acceptance.

Содержательные существующие quantity/role/navigation/DnD проверки, scoped lint и TSC завершают local verification. React counters не называются input latency. Итоговые измерения141 после оптимизаций отдельно используют доступныйПК, без ожидания iMac и без утверждения причины драйвера/GPU.

## Risks / Trade-offs

Always-mounted child сохраняет direct-close drafts; условное mounting изменило бы их. Busy union сохраняет старое ограничение submit во время status transition. Сравнение сжатых PNG bytes может различаться при одинаковых pixels, поэтому threshold остаётся точным RGBA0diff, а оба byte hashes сохраняются.

## Migration Plan

Миграций нет. Local affected checks → независимый code/evidence review → атомарный143 commit → root normal staging merge/CI → actual staging scenario. Main/production, restic/dumps/seed/reset/newDB запрещены; SAFETY-RULES и STOP при guard mismatch обязательны.
