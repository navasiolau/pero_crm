# Tasks

## 1. Durable deletion

- [x] 1.1 Добавить targeted RED действующего action: audit/intent failure сохраняет File, storage failure сохраняет intent, повтор UUID не дублирует аудит; зафиксировать actual RED.
- [x] 1.2 Реализовать tx core/receipt/current ACL и exact storage intent, внутренний route135 и pinned client UUID; targeted action/replay/ACL проверки должны стать GREEN.
- [x] 1.3 Реализовать identity/live-reference/local containment/reparse/ENOENT guards и ordinary S3 DeleteObject; targeted controlled storage/lease/restart tests должны сохранить соседние файлы и новую привязку.

## 2. Verification

- [x] 2.1 Проверить scoped typing/lint/OpenSpec и независимый CODE review; migration/schema/lockfile неизменность и exact source scope записать в evidence.
- [x] 2.2 После reviewed protocol/Root ONE выполнить один exact-owned native на существующей5433: audit/intent rollback, concurrent replay, pending storage/restarted dispatcher, exact cleanup и original rows/catalog equality.
- [ ] 2.3 После обычного merge/CI принять actual staging revision/image/identity и scoped сценарии удаления/повтора/cleanup с сохранением оригинальных данных; до этого отметить NOT_RUN.
