# Tasks

## 1. Implementation

- [x] 1.1 Добавить actual-context regression и зафиксировать RED без нового emitter wiring.
- [x] 1.2 Убрать runtime context→events через обязательный emitter, обновить все callsite; подтвердить GREEN и отсутствие обратного импорта.
- [x] 1.3 Проверить nested emit/actor/settings/audit/permissions, disabled hook/internal cleanup и failure/backoff существующими целевыми queue scenarios; сохранить результаты.

## 2. Verification

- [ ] 2.1 Выполнить один strict typing, scoped lint, OpenSpec validation и независимое review; source/schema/lock scopes проверить diff.
- [ ] 2.2 После обычной staging интеграции подтвердить actual SHA/health и scoped event/context scenario без глобального worker/чужих pending; записать actual acceptance.