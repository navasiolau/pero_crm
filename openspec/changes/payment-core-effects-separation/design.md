# Design

## Decisions

- Core возвращает {ack, optionalminimalcontext}; transaction и confirmation133 неизменны. Reader, prepare, transaction явно переданы, concrete singleton/Next effects собирает compatibility service.
- Context содержит paymentId/eventId/project id+number/direction/amount/currency/comment/actorId; не сырой Prisma-record. Public wire ACK без расширения полей.
- Post-commit service строит прежние dispatch/org/cache effects и передаёт existing deliverPostCommit133. Service adapter даёт реальные dispatch/notify/revalidatePath. Replay/rollback/UNKNOWN context не содержат, поэтому effects не повторяются.
- Exact optional effect order/cache paths/notification semantics сохранены. No generic new dependency engine. Existing native fixtures остаются допустимыми через service API; live money logic не меняется.

## Verification

One meaningful pure-core test без Next/notification mocks проверяет minimal result + zero effects/replay. Existing receipt/BYN/document/balance/concurrency/ACK-loss/effect-failure/web-bot/cache assertions retained, selected affected tests/types/lint/strict. DB/browser повтор по умолчанию не нужен: financial transaction/UUID/FX guards не изменяются; Root review обязателен.
