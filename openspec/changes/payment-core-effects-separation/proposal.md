# Proposal

## Why

№154: общий web/bot payment core импортирует Next cache и optional notification/dispatch effects. Денежный сценарий и доставка смешаны, хотя транзакционное ядро и подтверждение №133 уже выделены.

## What Changes

- Framework-independent createPaymentScenario с явными reader/prepare/transaction dependencies, прежними financial checks/confirmation и результатом ACK + минимальный post-commit context.
- Один service сохраняет публичный createPaymentCore(actor,input) ACK и собирает production dependencies. Web и bot вызывают его одинаково.
- Один payment post-commit service с явными dispatch/notify/cache ports использует existing deliverPostCommit133; Next cache остаётся адаптером. Replay/failure не доставляют effects.
- Transaction/receipt/UUID/fingerprint v1/FX/roles/math/history не изменяются. Projects/payroll/stock cores и generic port engine вне scope.

## Capabilities

### New Capabilities

- payment-scenario-boundary: общий платёжный coordinator без Next imports и один адаптер эффектов.

### Modified Capabilities

Нет.

## Impact

feature/154 от fresh origin/staging cfc4 + ordinary dependency merge134 (77d56c8), both task-create/stock-purchase diagnostic keys сохранены. Production: payments/core/service/post-commit, web actions и bot payments route imports. Necessary existing tests/native imports только указывают на compatibility service. Meaningful pure-core/no-effects regression + existing money/parity/cache failure checks. No schema/deps/lockfile/auth/history/SQL/browser changes. Root IMPLEMENT approved; commits/staging authorized, merge/push only Root. SAFETY-RULES обязательны, STOP guard mismatch, main/production/restic/dumps запрещены.
