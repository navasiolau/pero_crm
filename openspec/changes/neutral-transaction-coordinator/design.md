# Design

## Decisions

- Переносится existing implementation byte-semantics: callback получает тот же Prisma.TransactionClient после того же transaction-scoped advisory lock; options unchanged.
- Shared singleton создаётся ровно один раз в neutralmodule. Legacy named exports — re-export aliases, без новой factory call/обёртки. All domains и old DI callers сохраняют identity/behavior.
- Confirmation133 меняет только type source, fresh fence ждёт тот же lock. Payment154 dependencies меняют только type source. No generic engine/optional policies/segmented locks.
- Ожидание lock наблюдается через pg_locks для двух настоящих соединений в одном focused native сценарии, без production telemetry или новой framework.

## Verification

Существующие taskadapter/cashmixed/replay/confirmed-failure тесты, одна регрессия alias/options/rollback; types/lint/strict. Один native сценарий вызывает прежние writers расхода500 и аванса600 из owncash1000 на двух соединениях. Helpers163/161 обеспечивают guards цели, fingerprints, журнал до commit, блокировку exact PK и отказ при чужих FK. Fresh fence подтверждает abort через второй connection; повтор UUID не создаёт новых payment/audit/event. Удаляются только запланированные и фактически наблюдённые own IDs; all64 originals/schema сверяются до/во время/после. Импорт инертен; actual native разрешается только independent review + Root ONE на существующей local5433. Historical/frozen records не изменяются, warehouse не инициализируется.
