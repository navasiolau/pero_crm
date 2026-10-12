# Design

## Context

Base f479f46fe0bb30491f649e52a6962a5b1a7962d1, bugfix/134. PaymentInput UUID optional; core уже читает actor-bound receipt до preparePayment/НБРБ. PaymentDialog сбрасывает UUID каждый open. Public producers: web addPayment и Telegram engine→POST /api/v1/bot/payments→createPaymentCore. Stock/logistics callbacks без ordinary UUID защищены собственным required outer command и validated server-only movement/allocation context.

## Goals / Non-Goals

**Goals:** required public UUID, совместимый v1 receipt, current actor precondition, frozen pending UUID/payload при reopen/remount/reload, meaningful retained/native/runtime proofs.
**Non-Goals:** Auth/JWT/provider/AppShell/pages изменения, новый session namespace, миграции, исторический FX/payroll/settled перерасчёт, универсальный coordinator или QA framework, automatic mutation на mount.

## Decisions

- Payment fields отделены от public required UUID schema. Internal details parser выбирается только при explicit typed server-only context; ownership/amount/document guards прежние. Public JSON не выбирает эту ветку. Optional validated UUID внутреннего stock callback сохранён (existing inner receipt); logistics по-прежнему запрещает его своим guard. No server fallback UUID.
- Fingerprint v1 bytes и old receipt сохранены; expectedActor/transport в hash не добавляются. Replay остаётся до prepare/FX. Receipt reader проверяет actual actorType/user, namespace/entity/action и old normalized fingerprint; removed payment не воссоздаётся.
- readonly getPaymentActorId в existing actions использует requireFinance→session.user.id. Hook ждёт identity до restore/submit; web/paid-stock wrappers сравнивают expectedActorId с current server session до core. Grants/Auth не меняются.
- Один narrow browser controller сохраняет frozen wire payload/UUID до send в sessionStorage actor+dialog scope. SSR shared mutable store отсутствует. Restore не запускает mutation; same actor после re-login сохраняет intent, иной actor его не видит. Late ACK другого generation не применяется.
- После UNKNOWN любой rollback/absence текущей попытки удерживает UUID, поскольку исходный запрос мог ещё не дойти до lock. Освобождение: matching COMMITTED ACK либо actor/UUID-bound historical removed-ID proof; first directly confirmed rollback без прежнего UNKNOWN допускает новый draft. In-flight clicks coalesce, changed payload blocked, storage failure до send.
- После независимого P1 review paid-stock service различает confirmed prewrite/rollback и UNKNOWN receipt/commit; accepted133 confirmMutation использует прежний withTaskTransaction/fence. Optional effects не меняют committed ACK. Wrapper сохраняет outcome сервиса; first definite отказ допускает исправленный новый intent, prior UNKNOWN не освобождается. Fixed project scope сверяет saved payload projectId.
- Диалог восстанавливает money/manual rate/rateDate/paidAt/comment/report ID, останавливает editable fields/FX fetch при pinned intent; «Проверить» отправляет exact payload. Paid-stock outer receipt/fingerprint не меняются. Новое сознательное назначение после resolved intent получает новый UUID.

## Risks / Trade-offs

- Старые/direct callers без UUID → понятный отказ до FX/writes; только необходимые existing fixture adaptations, прежние assertions сохранить.
- Corrupt/unavailable storage → fail-closed, не генерировать новый UUID поверх неизвестного.
- AuthenticationSessionId namespace был отклонён Root: same actor re-login должен подтвердить прежний intent. Existing session user ID достаточен, server precondition не даёт полномочий.

## Migration Plan

Root согласовал narrow scope и IMPLEMENT NOW. Production: payments/contracts,receipts,core,actions,transaction,prepare; stock-purchase-core/logistics payment-context internal types; stock-purchase-actions thin wrapper, stock-purchase-service confirmation/effects, additive post-commit diagnostic; PaymentDialog и один controller. Schema/deps/lockfile/Auth unchanged. Meaningful DI/types/lint/strict, existing native/browser helpers в Root windows, independent review, atomic commit/ordinary staging merge/actual acceptance. Current local5433 window147; никаких SQL до отдельного Root slot. SAFETY-RULES D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md, STOP guard mismatch; no dumps/seed/reset/newDB/restic/main/production/outbound notifications.
