# Spec Delta

## Purpose

Денежное намерение должно быть подтверждаемым и устойчивым к потере ответа, чтобы повтор сохранял один платёж и прежние финансовые снимки.

## ADDED Requirements

### Requirement: Required public identity

Ordinary web/core/bot REST create-payment inputs MUST требовать canonical UUID до FX preparation и writes. Server actor/normalized fingerprint SHALL определять receipt; client fingerprint не доверяется. Internal stock/logistics callbacks SHALL сохранять required outer commands и server-only guards.

#### Scenario: Старый либо повреждённый public input
- **WHEN** UUID отсутствует/повреждён либо JSON пытается выбрать внутренний context
- **THEN** payment/audit/outbox/receipt/FX не выполняются, public bypass отсутствует

### Requirement: Compatible actor-bound replay

Система SHALL читать receipt до курса и возвращать original payment ID без новых snapshots. Другой actor/payload MUST получать отказ; removed payment MUST NOT воссоздаваться.

#### Scenario: Повтор при outage и изменившемся курсе
- **WHEN** committed intent повторён при недоступном НБРБ/новом курсе
- **THEN** original ID/amount/rate/date/BYN snapshot сохранены

#### Scenario: Десять одинаковых и два самостоятельных запроса
- **WHEN** десять запросов имеют один actor/UUID/payload, а два сознательно новых имеют разные UUID
- **THEN** первый набор создаёт один ID; самостоятельные команды разрешены прежними balance/fund/document guards

### Requirement: Current actor precondition

Web SHALL сравнивать expected actor с current server session до payment core, не доверяя клиенту полномочия. Late old-actor ACK MUST NOT менять новое намерение.

#### Scenario: Смена аккаунта
- **WHEN** expected actor не совпал с authenticated actor
- **THEN** отказ до writes; чужой pending context не показан

### Requirement: Pinned UNKNOWN recovery

После UNKNOWN система MUST сохранять exact UUID/payload до matched durable ACK либо matched historical removed-ID proof. Attempt rollback/absence MUST NOT освобождать UNKNOWN; clicks SHALL coalesce. Reopen/remount/reload browser-tab session SHALL восстановить actor-scoped context без automatic mutation. Same actor re-login SHALL сохранять прежний intent. Storage failure/corruption MUST NOT приводить к fresh UUID поверх неизвестного.

#### Scenario: Lost ACK → attempt refusal → reopen/reload → replay
- **WHEN** commit ACK потерян, повтор отклонил только себя, а форму закрыли или загрузили заново
- **THEN** money/manual FX/date/report ID и UUID сохранены; «Проверить» отправляет original payload и подтверждает original ID

### Requirement: Historical facts and restrictions

Система SHALL сохранять Decimal/currency snapshots, финансовые потолки, document ownership, grants/audit/transaction locks. Later rates/settings MUST NOT переписывать historical payroll/percentage facts.

#### Scenario: Retained finance/stock/logistics scenarios
- **WHEN** прежние разрешённые/запрещённые операции проверены
- **THEN** прежние суммы и ограничения сохранены, новых начислений/исторических пересчётов нет
