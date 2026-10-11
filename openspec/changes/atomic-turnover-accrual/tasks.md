# Tasks

## 1. RED и общий оборот

- [x] 1.1 Зафиксировать deterministic concurrent RED на исходной action и orphan-audit fault; два одинаковых stale reads дают600 при ожидаемых300, failed audit оставляет row до исправления.
- [x] 1.2 Ввести один Decimal turnover reader и сохранить прежний number DTO; tests проверяют active payment filter, month131 boundaries, fixed BYN и отсутствие float потери.

## 2. Атомарное ядро и action

- [x] 2.1 Реализовать core под существующим transaction: reread turnover/rate/history и atomic payroll/audit/outbox; десять concurrent requests дают300, рост12000 даёт60, replay/decline/unknown/fault tests подтверждают history/rollback.
- [x] 2.2 Подключить action и прежние post-commit effects; actual wrapper tests показывают confirmed money ACK при dispatch/notification/cache failures, public signature/UI сохраняются.
- [x] 2.3 Адаптировать три существующих suites к transaction delegates без удаления защитных assertions; combined-role, fixed foreign BYN и month131 regression проходят.

## 3. Local/native/review

- [x] 3.1 Выполнить relevant tests и согласованные typing/lint; OpenSpec/diffchecks проходят, evidence содержит команды и уровень доказательства.
- [x] 3.2 Независимо согласовать runnable native protocol и root execution GO до setup; guards/exact owned manifest/temporary commit+cleanup/fingerprint flow проверены, no new DB/dump/seed/migration/restic.
- [x] 3.3 Выполнить reviewed native на existing local5433 минимум через2коннекции: concurrent total300/topup60, payroll/audit/outbox faults атомарны, exact cleanup и protected fingerprints equality подтверждены; при anomaly STOP, не PASS.
- [x] 3.4 Пройти независимый code review и исправить замечания с relevant reruns; final CODE_REVIEW_GO записан в evidence.

## 4. Staging

- [ ] 4.1 После обычной интеграции и CI оркестратор фиксирует actual staging SHA/image/health и runtime/role/period/core UI сценарии; controlled fixtures/history сверены, main/production не изменены.