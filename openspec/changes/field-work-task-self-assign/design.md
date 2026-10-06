# Design
## Context
См. proposal. Сейчас addWork и worker-назначение разрешены только WORKER (плюс менеджеры): canAddProductWork проверяет hasRole WORKER, addWorkCore и worker-allocation-core требуют роль WORKER у актора, listWorkPriceOptions и listWorkerAllocationData отфильтровывают не-WORKER, workerOptions содержит только WORKER, products/[id]/page.tsx включает canAllocateWork только для WORKER. MOUNTER уже видит карточку изделия через полевые гранты видимости и исполняет назначенные задачи со сдельщиной PIECE — не хватает только создания работ и раздачи задач.

## Goals / Non-Goals
Цели: разрешить MOUNTER то же узкое полевое создание работ и кросс-ролевые назначения WORKER↔MOUNTER внутри живого PRODUCTION-изделия; подсказка пустого прайса; те же проверки остатка и идемпотентности. Вне целей: PriceItem CRUD, классические задачи менеджера, начисление PIECE, навигация (nav.ts, tasks/page.tsx), видимость изделий, статусы и финансы.

## Decisions
- Единый полевой набор FIELD_ROLES (WORKER, MOUNTER) из lib/roles как источник истины вместо точечных hasRole('WORKER'): canAddProductWork, addWorkCore (гейт актора и проверка статуса), listWorkPriceOptions, createWorkerTaskAllocationCore (актор и получатель), listWorkerAllocationData (гейт актора и workerOptions через hasSome обоих), canAllocateWork на странице изделия.
- Ограничения создания работ без изменений: только status==PRODUCTION, обязательный productId того же проекта/изделия, активный PriceItem, серверный снимок цены/единицы/количества через inputNorm/scaleNorm/workBudget, строгий payload без подмены unit/priceSnapshot/total/paymentKind, атомарный аудит.
- Ограничения назначений без изменений: только LEGACY-работа без stagePayPoolId и с priceSnapshot!=null того же проекта/изделия, остаток через allocatedWorkQuantity (группы считаются один раз), NULL-количество блокирует распределение, обязательная оценка времени, идемпотентный receipt по clientMutationId с fingerprint, атомарные task/audit/event.
- UI: canAddWork и canAllocateWork уже разделены с canManage — для MOUNTER включаются теми же пропсами; в диалог новой работы добавляется подсказка «Прайс пуст — обратитесь к менеджеру» при пустом списке расценок; кнопка добавления остаётся заблокированной без выбранной расценки. Отдельных контролов создания прайса в TasksTab нет и не добавляется.
- Навигация и tasks/page.tsx не трогаются: MOUNTER открывает карточку изделия по ссылке из своих задач (/my), как и раньше.

## Risks / Trade-offs
- Расширение workerOptions до MOUNTER увеличивает список исполнителей — приемлемо: получатель всё равно проверяется сервером внутри транзакции по текущим ролям/active.
- Кросс-ролевые назначения могут смешивать сборку и монтаж в одной работе — приемлемо: владелец утвердил, объём и цена работы не меняются, зарплата считается как раньше.
- Пустой прайс у полевых ролей теперь виден явно через подсказку — снижает обращения в поддержку, прав не расширяет.
