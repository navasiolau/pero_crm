# Proposal

## Why

№134: optional clientMutationId отключает денежный receipt для старых/прямых клиентов. PaymentDialog выдаёт новый UUID при каждом open, поэтому потерянный ACK с последующим reopen/reload способен создать второй платёж.

## What Changes

- **BREAKING**: поддерживаемые обычные web/core/bot REST create-payment входы требуют canonical UUID; отсутствие/повреждение отказывает до currency preparation и записи. Server actor и прежний нормализованный fingerprint v1 определяют receipt, клиентский fingerprint не принимается.
- Сохранить прежний payment-request receipt и порядок replay-before-rate-fetch, manual-rate snapshots, запрет воссоздания удалённого платежа. Старые денежные/процентные/зарплатные facts не обновляются.
- PaymentDialog сохраняет frozen request/UUID до matching ACK, включая close/reopen/remount/full reload этой browser-tab session. Actor определяется из существующей серверной сессии; pending context sessionStorage привязан к actor/dialog scope. Same actor после повторного входа может подтвердить прежний intent; другой actor его не видит. Mount/open не выполняют mutation.
- Тонкий readonly getPaymentActorId в existing actions разрешает текущего actor до восстановления/submit. Web action сравнивает expectedActorId с текущей session.user.id до core. Auth/JWT/provider/AppShell и grants не меняются.
- Internal stock/logistics payment callbacks сохраняют собственный обязательный outer UUID/receipts и server-only movement/allocation guards. Отдельный internal fields contract доступен только при явном typed server context; публичный API не выбирает его данными JSON.

## Capabilities

### New Capabilities

- `payment-command-intents`: обязательный ordinary payment UUID, совместимый actor-bound replay и восстановление pinned UI intent.

### Modified Capabilities

Нет: действующих money specs в основных пяти capabilities нет.

## Impact

- Ветка bugfix/134 от fresh origin/staging f479f46fe0bb30491f649e52a6962a5b1a7962d1; отдельный worktree improvements-134. №133 принят, №165 source не копируется.
- Production scope: payments/contracts,receipts,core,actions,transaction,prepare; stock-purchase-core и logistics/payment-context только internal types; stock-purchase-actions thin actor/ACK wrapper; stock-purchase-service confirmed prewrite/rollback/UNKNOWN и accepted133 commit/effects boundary; additive stock-purchase diagnostic в post-commit; PaymentDialog и один narrow browser controller. Bot producer уже генерирует UUID; REST route использует тот же core, фактические ingress proofs сохраняются.
- Schema/migrations/dependencies/lockfile/Auth не меняются. Native и browser windows согласует Root отдельно; local147 использует БД сейчас. Main/production, dumps/seed/reset/newDB/restic и внешние уведомления запрещены. SAFETY-RULES обязательны, guard mismatch — STOP.
