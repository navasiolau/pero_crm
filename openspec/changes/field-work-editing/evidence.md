# Evidence

## Scope

Задача №120, `feature/120`, исходный staging `a491e974b26fa0d80f0ecb1296188b09c90d4a16`. Worktree — `C:/Users/admin/.codex/worktrees/crm-120-works/pero_crm_v2`. Номер, OpenSpec и реализация согласованы владельцем. Чужие файлы не изменялись; коммиты, merge и push выполняет root.

## Implementation

- Создание и редактирование обычных работ используют актуального actor, `productVisibilityWhere` и статусную матрицу №119. Самостоятельные WORKER/MOUNTER не зависят от координатора. `canCreateOrdinaryWork` подготовлен как отдельный create seam для №121; update/remove/self-take не получают его дополнительного grant.
- Typed update блокирует Product→Work→Task под общим task transaction/advisory lock, сверяет ревизию плановых полей и всех задач, сохраняет receipt. Ревизия не хеширует денежные снимки. Quantity/norm/total вычисляются точной decimal-арифметикой; tasks, time и payroll не переписываются.
- Позиция активного прайса меняется только до задач и начислений. Тариф, единица и название берутся с сервера. Процентные, pool/weight/conversion/settlement работы и неизвестные прежние price/quantity не превращаются в обычные нулевые факты.
- Агрегат занятости берёт все задачи работы, включая группы; DTO отдаёт только allocated/remaining, ревизию и operation grant. Суммы/задачи коллег в новый редактор не передаются.
- Один WorkDialog служит созданию и правке; QuantityStepper имеет режим плановой нормы. «Взять себе» вызывает strict endpoint без клиентского assigneeId. Старое разрешённое назначение другому сохраняется только в допустимом статусном контексте получателя.
- Создание, update и self-take сохраняют UUID запроса при неизвестном ответе и подтверждают повтор без второй работы/задачи. Старый addWork payload без UUID остаётся совместимым.
- Миграций нет. Roles, prices/users/nav/compensation policy и workflows агентом №120 не менялись.

## Local verification

10.10.2026 выполнен **ровно один** native-сценарий:

```powershell
pnpm exec tsx tests/field-work-editing-native.ts
```

Результат — exit 0 за 2,58 секунды. Harness перед SQL проверил Docker ID `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, running, существующий volume `pero_crm_v2_pgdata`, loopback 5433 и `current_database()=pero_crm`. DATABASE_URL загружен самим процессом из приватного `.env.local`, значение не выводилось.

```json
{"ok":true,"database":"pero_crm","checks":["worker-create-storage-and-replay","status-matrix-and-strict-payload","change-price-before-tasks","edit-twelve-floor-cas-replay","last-quantity-and-special-work-refusal"],"outerRollback":true,"ownRowsRemaining":0}
```

На собственных, видимых только во внешней транзакции QA-строках проверены создание для Worker/Mounter/совмещённого профиля в допустимых статусах, запрет скрытого статуса и ручного тарифа, повтор создания, смена прайса до задач и сохранность снимка после изменения каталога. WORKER получил собственную задачу 6 из 10; увеличение плана до 12 вернуло свободные 6. Уменьшение до 5, смена тарифа после задач/начисления и stale revision отклонены. Task/TimeEntry/PayrollEntry before/after JSON совпал; последний остаток не превышен, receipt replay не создал дубль. Специальная работа отклонена.

Внешняя транзакция откатила все QA-данные; собственных пользователей, проекта и позиций прайса после rollback нет. Существующие бизнес-строки не менялись. В том же сценарии новый operation DTO проверен на отсутствие `tasks` и `priceSnapshot`.

По прямому QA-уточнению владельца отдельный baseline/RED, multiconnection concurrency, локальный browser, повторные широкие suite/typecheck/lint/build прогоны не выполнялись. Это не доказательство отдельного реального межсоединительного race; существующий общий writer/locks и полный CI сохраняются. Дампы, restic, seed/reset и новый стенд не использовались.

## Handoff

Локально готовы код и native GREEN. Остались unchanged full CI и одна фактическая staging-приёмка root, которая также завершит UI-пункт 3.3: Worker(PRODUCTION/STORAGE), Mounter(INSTALLATION), совмещённый профиль, create→edit→self-task, desktop/mobile и снимки. Staging/main не выдаются за принятые до фактического deployment и сценария.

Для №121: добавить `hasWorkCoordinator(roles)` только в `canCreateOrdinaryWork`; в `canAddProductWork` после draft guard разрешить independent WC create в уже фактически видимом product. Транзакционный visibility guard сохраняется. Helper редактирования, removeWork и own allocation не расширять. Конфликты old status assertions/works core с исправлением №119 разрешать по итоговой №120 матрице обычным merge.
