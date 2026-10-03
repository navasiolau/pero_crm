# Tasks

## 1. Storage и контракт
- [x] 1.1 RED→GREEN strict storage config и безопасный error DTO; focused unit tests (RED2→GREEN2).
- [x] 1.2 RED→GREEN ordinary receipt/replay/conflict/audit rollback/late notify; focused backend tests (RED3→GREEN5, включая unknown commit и thumbnail).
- [x] 1.3 Route сохраняет ACL/validation, original bytes, cover CAS и закрытый JSON; targeted route regressions (26/26 PASS).

## 2. Проверки
- [x] 2.1 Проверить scoped lint/typecheck и OpenSpec strict; whole tsc PASS, scoped lint0errors/0warnings, strict valid.
- [ ] 2.2 Root выполняет actual staging assurance/upload/replay/cleanup после deployment с CRM_FILE_STORAGE=s3; runtime QA до исполнения остаётся pending.
