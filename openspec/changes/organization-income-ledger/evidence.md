# Evidence

## Local

Feature61 создан после fresh fetch origin/staging d94e25d; собственные offline/frozen/ignore-scripts dependencies и Prisma generate. OpenSpec4/4 и strict validation выполнены до кода; владелец уже разрешил весь план через staging.

Payment получает nullable projectId/projectAmount, forward migration 20261003080000 сохраняет все строки и CHECK парности project fields: без проекта допустим только INCOME. Действующий проект по-прежнему обязателен для EXPENSE, дважды проверяется вместе с cash внутри прежней денежной транзакции.

Реальный createPaymentCore: общий USD100 фиксирует BYN300 и две NULL-связи без чтения Project. Payment, ChangeLog и outbox создаются атомарно. Реальный delete core сохраняет кассовый и организационный потолки, nullable project не мешает аудиту. Физическая валюта, сохранённая дата/курс, Decimal half-up и fail-closed исторических выплат сохранены. Общие/кассовые/месячные агрегаты не менялись: они уже считают все Payment. Project economics остаётся по projectId.

Actual behavioural RED: общий приход был отклонён прежней обязательной project-схемой, 1 fail/2 pass в income-red.private.log; GREEN новые7 и прежние денежные/workspace14 =21/21 PASS. TypeScript PASS, scoped ESLint0/0. Старые mocks дополнены transactional audit/outbox/dispatch, прежние валютные и competing-expense assertions сохранены. Логи находятся в ignored `.playwright-mcp/round2/income-*.private.log`.

Финансовый журнал /finance/income разрешает central FINANCE_ROLES, использует safe live project picker и общий PaymentDialog. Общий приход имеет явную подпись без фиктивного проекта; confirmed ACK обновляет журнал, failure сохраняет форму. Nullable projectAmount не превращается в ноль в workspace DTO. Карточка прихода добавлена отдельно от будущей навигации авансов №60.

## Native Preparation

Private runner `.playwright-mcp/development61/native-runner.mjs` и build-native.mjs собраны, НЕ запущены работником. Explicit local guard: PostgreSQL, localhost только после DNS loopback proof, канонический127.0.0.1:5433/pero_crm. Existing private env читается только во время root execution, секреты не выводятся. Нужна актуальная локальная схема ранее интегрированных задач54/58/62.

Пять actual SQL/core групп подготовлены: static nullable DDL/CHECK без изменения прежних данных; один общий приход/аудит/outbox и cash/org/month+неизменная project economics; расход без проекта/cash mismatch/Finance denial и реальный CHECK; audit failure SAVEPOINT rollback; delete cash ceiling и допустимое nullable удаление. Весь запуск завершается deliberate outer ROLLBACK с точным сравнением всех public base-table count/md5, columns/indexes/constraints. External fetch запрещён. Это авторство runner, НЕ фактический PostgreSQL PASS и НЕ hosted concurrency.

## Pending

Root выполняет local native, ordinary merge, CI и приёмку фактически развёрнутого staging image/health/денежного smoke. Task3.2 остаётся unchecked. Никаких DB execution, seed/reset/newDB, restic/dumps, SSH, production, commit/push работником не выполнялось. Main не разрешён.
