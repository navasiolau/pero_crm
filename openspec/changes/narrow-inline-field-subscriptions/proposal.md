# Proposal

## Why

ProductInlineDetails подписан на целые снимки цены/количества и заново создаёт соседний description при каждом символе. ProjectConfirmedTotal читает только baseline и признак pending, но реагирует на каждый draft/error snapshot.

## What Changes

- В том же product-inline-fields.tsx вынести прежний div живой суммы в небольшой ProductLiveTotal, подписанный только на price/quantity drafts.
- Убрать подписки цены/количества из ProductInlineDetails: родитель, описание, measurement и engineer не исполняются от чужого ввода.
- В project-inline-fields.tsx читать стабильные primitive baseline/pending проекции трёх услуг. Первое dirty/saved событие по-прежнему меняет подсказку; последующие символы при неизменных baseline/pending не рендерят итог.
- Сохранить точные money/null/zero расчёты, labels/classes/locale, readOnly/showAmount и controllers/CAS/UUID/retry/IME/Enter/blur/RSC behavior.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет изменений требований. Изучены действующие product-inline-editing/project-inline-editing deltas; skip_specs true для чистой оптимизации подписок.

## Impact

bugfix/144 от fresh origin/staging f479f46fe0bb30491f649e52a6962a5b1a7962d1, отдельный worktree improvements-144. Только2production modules; не менять providers, generic controller, parser, financial calculations или source143/165/134. Для проверки переиспользовать existing Chromium launch и authored-body observer с тремя literal targets, один actual before/after case без нового framework/inventory.

Измеримый результат:0description/parent body calls при наборе цены/количества; live total меняется немедленно; ProjectConfirmedTotal0body calls на последующие символы при прежних baseline/pending. Ошибки/поздний ACK не уничтожают draft; подтверждённая сумма соответствует прежнему расчёту.

Root разрешил144 implementation/минимальные local checks; затем independent review/root normalstaging integration/actualacceptance. Main/production, restic/dumps/seed/reset/newDB запрещены. SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP приguard mismatch.141 оценивается на доступномПК, device не ожидается.
