# Design

## Context

Официальные planning артефакты №17 подготовлены через OpenSpec CLI от origin/staging 9fb844fc4b427cfa6df5c7d7741d79496260e328. После фактической staging-приёмки №16 и следующего merge только QA/документов создана feature/17 от свежего origin/staging 44281e4f229a9d655b70f0f73151413af66296f8. Владелец разрешил дальнейшую работу до tested staging без новых согласований; main/production не входят.

Наблюдаемое состояние: `products/[id]/product-header.tsx` держит общую форму в Dialog, несколько useState, Number(price), полную updateProduct и router.refresh. `products/[id]/page.tsx` отображает shared Project/Client реквизиты и собственное описание серверно. `server/products/actions.ts` смешивает auth, validation, Prisma, quantity, audit и внешние postcommit эффекты. Уже есть `products/quantity-core.ts` (row lock/нормы), `products/status-core.ts` (права/снимки/history/outbox), `tasks/transaction.ts` (короткий общий advisory lock), `roles.ts`/access visibility и BYN helper №16. `clients/actions.ts` обновляет Client без CAS и пишет аудит после записи. `hooks` содержит только use-mobile, useInlineSave отсутствует. Обнаруженный bot API обновляет Project через projects/core; отдельный product bot writer исследованием не найден — не создавать его в №17.

## Goals / Non-Goals

**Goals:** небольшой общий механизм частичного сохранения и профильное product ядро, сразу работающие на существующих полях; пригодные для №18 hook/contract primitives без реализации проектной карточки №18.

**Non-Goals:** новые финансовые формулы/проценты, initialPrice изменение/скрытие №26, large textarea и новая семантика whitespace №19, rearrange page/tabs №25, вложения/cover, новая API-платформа и изменение схемы БД. Начальная Textarea остаётся обычной нынешнего размера; описание использует нынешнюю нормализацию до отдельного №19. Существующие initialPrice create/update пути не расширяются новым inline allowlist.

## Decisions

### Закрытый discriminated contract

В `products/patch-contract.ts` описать product fields `title`, `kind`, `quantity`, `expectedPrice`, `engineerId`, `description` с точным типом value/expectedValue для каждого поля. Общие `project.clientId`, `project.address`, `client.phone` имеют отдельные discriminated variants, productId как точку доступа и expectedClientId для телефона. UUID clientMutationId обязателен. Деньги — канонические десятичные строки либо null; quantity — целое number; optional text/IDs различают null и пустое значение. В серверных схемах закрытый набор полей, запрет неожиданных currency/initialPrice/произвольных колонок. Наружу не выдавать сырой Prisma.

Ответ: `{kind:'saved', clientMutationId, field, value, derived}` либо `validation` с field/message, `conflict` с разрешённым currentValue/актуальной связью либо `forbidden`/`not-found`/`failure`. Derived типизированы: после цены/quantity только lineTotalBYN+quantity/currentUnitPrice; после engineer/client только разрешённые подписи. Деньги возвращаются строками, служебные даты ISO. Не выдавать hidden sums конфликтом.

Альтернатива универсальному JSON update — неподходящая: теряет allowlist/типы/правила количества и позволяет случайный mass assignment.

### Product core и reuse прежних writers

В `products/core.ts` вынести create/update business операции из actions, оставив transport auth/DTO/call/revalidate. Новый patch core использует те же validation/role/engineer/BYN/quantity helpers; quantity всегда вызывает `recalculateQuantity` после row lock, статус остаётся `changeProductStatusTransaction`. Все существующие product update callers перевести на доменную операцию: обновления full legacy формы должны не игнорировать CAS, а либо передать baseline для изменённых полей, либо получить ясный отказ обновить форму. Не отправлять целый stale product через новый transport. Create/delete/status/cover профильные операции сохраняют свои contracts и особенности, без объединения всех действий в универсальный setter.

Для общих реквизитов выделить ограниченные доменные операции Project/Client и использовать их из product patch; существующий `updateClient` использует то же ядро и прежний доступ вне product-карточки. Через product путь клиент/адрес/телефон редактирует менеджмент; Аудит фактического источника выявил прежний OFFICE_ROLES write-gate в clients/actions, противоречащий действующему AGENTS.md: ACCOUNTANT — просмотр, чистый ENGINEER — только свой технический блок. Standalone Client CRUD приводится к MANAGER_ROLES с объединением ролей (MANAGER+ENGINEER сохраняет запись); офисная видимость списков сохраняется. Это исправление исходного write-gate, без миграции и изменения Client.phone обязательности. Новая CAS защита общих реквизитов распространяется на вызываемые этим изменением writers; миграция всей Project UI с её layout/обычным inline flow остаётся №18.

### CAS, общая транзакция и receipt

Старая общая форма Project и адресный бот-диалог передают захваченный при открытии contactBaseline. Контактное поле, неизменённое относительно этого baseline, исключается из записи; изменённое проходит CAS под Project lock. Меняющий контакт запрос без baseline получает явный отказ. Это закрывает перезапись inline-контактов изделия старой проектной формой; layout проекта остаётся задачей №18. Аудит project update расположен в той же транзакции.

Использовать существующий `withTaskTransaction` и row locks для product; shared Project/Client операции используют согласованный порядок Project → Client/Product при необходимости, все обновления конкретного поля выполняют compare-and-set по expectedValue. Клиентский телефон дополнительно проверяет актуальный Project.clientId==expectedClientId внутри этой же транзакции, до Client update. При смене клиента проверить существование и разрешённую видимость выбранного Client. На конфликте expectedClientId только менеджменту вернуть currentClientId, currentClientLabel и актуальный currentValue телефона, прочитанные минимальным SELECT под Project→Client locks, без writes. UI сохраняет прежний draft; перенаправление к новому клиенту и новый baseline возможны только явным «Принять актуальное»/rebase, без автоматического retry или overwrite. Для forbidden metadata не возвращается. Для адреса input baseline — сохранённый Project.address (null отдельно), а отображаемый inherited Client.address — только hint; не выдавать inherited адрес за сохранённое прежнее значение.

Для изменённого поля аудит пишется через tx.changeLog, а необходимые существующие события — tx.domainEvent. Receipt для реальной мутации можно хранить в существующем ChangeLog с детерминированным ID product-inline:{clientMutationId}; payload содержит actor/entity/field и канонический fingerprint/value. Повтор проверяет actor/product/payload, возвращает сохранённое подтверждение и не повторяет effects. No-op с совпадающим baseline/value не пишет audit/event и не требует нового receipt; unmatched baseline — conflict. Не вводить таблицу, миграцию или универсальный журнал snapshot всех данных. Postcommit доставка/инвалидация после успешного commit, внешние API не удерживают tx.

### Очередь и черновики

`hooks/use-inline-save.ts` плюс небольшой тестируемый scheduler/reducer без новой зависимости: у поля confirmed baseline, draft, inflight mutation+ID, последний ещё не отправленный draft и status. Один inflight на поле; queued drafts схлопываются до последнего значения и после подтверждения используют обновлённый baseline. Enter+blur снимают один snapshot; equal draft/baseline запрос не создаёт. Потерянный ответ повторяется с тем же ID; новый ввод не создаёт ошибочно новую повторную запись. Ответ меняет baseline именно соответствующей мутации, но не заменяет более новый draft.

Конфликт показывает server value, сохраняя draft; пользователь может принять актуальное значение или повторить свой draft с новым актуальным expectedValue, без автоматического overwrite. Field error не блокирует соседний ввод. Shared field controller предоставляет `flush()` для статуса: проверяются цена/quantity/engineer и dirty существующих процентных настроек; статус не отправляется до их подтверждения. Существующие процентные панели пока сохраняют свои actions/формулы, но их dirty/pending/error состояние подключается к flush coordinator, новые percentage поля не создаются.

### Компактное представление

Реальный compiled browser показал, что Next15.5.20 callServer помещает все ответы Server Actions в одну router queue: задержанный ответ одного поля задерживает подтверждение соседнего. Поэтому поля используют небольшой независимый transport того же зарегистрированного Server Action: его ID берётся через React Flight encodeReply ссылки, POST остаётся same-origin/credentials с прежней серверной auth/Origin/CSRF проверкой, результат разбирается существующим Flight codec. IDs и внешние URLs не задаются пользователем; API route, Prisma writer и новая библиотека не вводятся. Transport принимает только compact action envelope и отвергает redirect/revalidation/full tree; зависимость от установленного Next/React протокола покрыта unit и actual browser проверками. Очередь внутри одного поля и retry receipt остаются прежними. Телефон дополнительно ждёт подтверждения локальной смены клиента и сохраняет старый draft до явного rebase нового клиента.

Небольшие Input/Select/Textarea wrappers и единый status/error UI; SearchableSelect для инженера/клиента. Заменить управление существующими полями product dialog на прямые поля карточки, сохранив общий layout и нынешние sections/tabs/cover. Первоначальные цены остаются в существующем compatibility представлении до №26; не добавлять новый inline editor для них. Статусный контроль использует flush и существующий core. Сохранение field не вызывает router.refresh или success-toast; local derived labels обновляются компактным ответом. Новый inline Server Action не вызывает revalidatePath/revalidateTag/router.refresh ни прямо, ни через старый compatibility wrapper/postcommit helper. Даже target revalidatePath текущей карточки запускает RSC и её дорогие queries, поэтому reuse касается domain core, а не action с таким side effect. Динамические страницы читают подтверждённую DB при следующей обычной навигации; текущие поля/derived labels обновляются из compact DTO. Для field POST обязательно измерить response size/type и отсутствие полного Flight tree карточки, повторных GET/RSC запросов, вызовов getProductFor/full finance/history. Малый primary payload сам по себе не доказывает отсутствие скрытой RSC-перезагрузки. Статус/файлы сохраняют свои профильные процессы вне обычного field POST.

### Обязательный телефон и пустые optional поля

Актуальный Client.phone — String NOT NULL без default, clients/actions clientSchema — min(1). План требует null только для пустых необязательных полей и ошибку для обязательных; он не объявляет телефон optional. Поэтому phone patch.value — непустой непробельный string, expectedValue — точное прежнее string, включая legacy "" для разрешённого исправления. Ошибка очистки телефона показывается у поля; Client.phone, create schema и прежние значения не меняются, миграция не требуется. Normalization применяется только к изменённому валидному вводу, не при открытии карточки. Optional Project.address, Product.engineerId/description/expectedPrice и другие уже nullable поля используют null согласно своим схемам. Shared phone CAS дополнительно проверяет expectedClientId; обязательность не отменяет защиту связи/конкуренции.
## Risks / Trade-offs

- [Legacy full-object writer обходит CAS] → инвентарь реальных callers и обновление их baseline/adapter; тест old-form rejection, не молчаливый server read нового baseline.
- [Shared phone меняет несколько заказов] → ясная подпись общего клиента, expectedClientId и race tests; локальная Project копия телефона запрещена.
- [Переключение статуса закрывает доступ инженеру] → актуальная role/status проверка в tx, сохранение перед переходом; существующий redirect после потери доступа сохраняется.
- [Аудит остаётся вне tx] → failure injection после data update доказывает rollback data/audit/outbox; no-op тест отдельно.
- [Глобальный task lock ограничивает throughput] → короткие операции без FX/read всей карточки, не менять систему блокировок в №17.
- [Core extraction разрастается] → только реальные writers изделия и нужные shared operations; не создавать альтернативную финансовую архитектуру.

## Migration Plan

Официальный CLI change готов от 9fb844f. После №16 acceptance и сигнала оркестратора: fresh refs/feature17; RED→GREEN DI/unit, существующее local окружение и browser network/concurrency/roles; один атомарный коммит по уже выданному разрешению, обычный merge staging/CI; фактический staging SHA/образ/здоровье и сценарии, включая 320×800,360×800,390×844,768×1024,1024×768,1440×900, sidebar/200%. Restic/дампы/reset/seed не используются, production не исследуется. При failure фикс в feature17 и повтор приёмки; Git истории не переписывать.

## Open Questions

После принятия №16 сверить свежие paths/callers и подключение dirty-state существующих percentage panels. Это техническая актуализация поверх принятого контракта, не повод менять scope или просить повторное согласование.
