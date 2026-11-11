# Design

## Context

Product.description сейчас String?, sync КП полностью заменяет его; patchProduct использует row lock, scalar CAS и receipt. КП хранит произвольные products; outer/inner означают наружный/внутренний материал, а не корпус/фасад.

## Goals / Non-Goals

**Goals:** JSON и независимые правки строк без потери старого текста, общая модель для следующего этапа КП.

**Non-Goals:** изменение state/редактора/PDF КП до #215, массовый backfill, production, новые зависимости.

## Decisions

- Product.technicalSpecifications Json? содержит {sections,description,size,note,sourceGeneration}; последние три содержательных поля string|null, sourceGeneration — внутренний неотрицательный счётчик смены снимка из КП. Product.description остаётся дословной legacy-копией, после перехода — только просмотр в сворачиваемой области. Старый текстовый writer после перехода возвращает конфликт.
- Общий UMD-модуль packages/kp-template/assets/public/js/furniture-specifications.js экспортируется как FurnitureSpecifications из @pero/kp-template с TS declarations. Публичный API модуля согласуется между workers до использования.
- Section: {id,type,group,label,value}; value — строка, group — construction|hardware|lighting|filling. Type: body,facade,worktop,upholstery,insertsAndHandles,hardware,lighting,interiorFilling,softFilling,custom. Канонические label/group задаются каталогом; стандартный type уникален в изделии. ID обозначает жизнь строки: новые строки получают UUID, сохранение сохраняет ID, удаление и повторное создание получают новый ID. Product add использует ID своего clientMutationId; legacy projection использует детерминированные ID. Custom label непустой. Порядок групп фиксирован, стандартная конструкция идёт в порядке каталога, custom — в порядке массива. Пустые значения скрыты в списке просмотра/печати, доступны в редакторе.
- Legacy adapter чистый и детерминированный: точные title/алиасы, иначе custom с literal title и стабильным id; outer/inner сохраняются с исходными подписями при необходимости различения; hinges→hardware, lighting→lighting, drawers→interiorFilling с привязкой к исходному заголовку. Не угадывать значения по материалу. Сохранять unknown source в исходном КП. В #214 adapter только проецирует Product, не переписывает state КП.
- JSON участвует в commercialSnapshot, diff, no-op и audit; actual save/restore целиком заменяет JSON, включая очистку отсутствующих значений. Новое изделие получает description=null, старое сохраняет raw description. Чтение не инициирует переход.
- Scalar CAS по sectionId/expectedValue под существующим Product row lock; независимые строки мержатся в свежий JSON. Add/remove — явные идемпотентные операции; remove сравнивает полную строку, зафиксированную при открытии подтверждения, late value-patch не делает upsert. Смена снимка во время подтверждения не подменяет его baseline. Дополнительные source fields также редактируются scalar CAS. Receipt проверяется под lock, права до результата и повторно под lock. Общий flush/guard включает новые контроллеры.
- При ручном первом заполнении null→пустая оболочка без разбора legacy. Новые входящие серверные значения принимает только чистый UI state; dirty/inflight сохраняет baseline для конфликта. Все существующие redaction технических данных распространяются на JSON.
- Source generation начинается с 0; фактический replace из КП увеличивает его, неизменный КП и manual mutations сохраняют. Технические patch сравнивают expectedSourceGeneration вместе со своим baseline. Это предотвращает ABA, когда КП вернул ранее удалённую строку с тем же source ID и значением. Чистый controller принимает новую generation вместе со значением, dirty/inflight сохраняет предыдущую; подтверждение удаления фиксирует обе части baseline.

## Risks / Trade-offs

- Неоднозначные старые блоки → сохранять смысл и исходный текст вместо автоматической классификации.
- Гонка sync/manual → общий Product row lock и CAS без изменения порядка Project→Proposal→warehouse→Product у КП.
- Необратимая потеря данных → nullable additive migration без UPDATE, raw legacy неизменен.

## Migration Plan

Guarded local PostgreSQL 5433, штатная migrate deploy только после проверки pending migrations. Затем обычный commit/merge staging/CI и фактическая staging-приёмка. Никаких local/staging дампов/reset/seed. Откат приложения сохраняет новую колонку и исходные данные. Production не выполняется.
