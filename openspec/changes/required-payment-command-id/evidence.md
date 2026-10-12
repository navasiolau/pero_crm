# Evidence — №134

## Implemented source

- Base: f479f46fe0bb30491f649e52a6962a5b1a7962d1; bugfix/134, isolated improvements-134.
- 13 production paths: PaymentDialog/controller; payments contracts/receipts/core/actions/transaction/prepare; thin paid-stock action wrapper/service confirmation+effects; one additive post-commit diagnostic; stock-purchase-core typed receipt error/internal type adaptation; logistics payment-context internal type adaptation.
- No Auth/JWT/provider/schema/migration/dependency changes. Ordinary public UUID required; internal fields parser selected only by a validated server context. Existing stock callback optional inner UUID remains valid; logistics retains its stricter guard. Existing v1 fingerprint body unchanged, receipt read before prepare/FX. Current authenticated actor rechecked by web/paid-stock wrappers before core.
- Frozen actor/dialog intent persisted before send. UNKNOWN survives reopen/full reload and later attempt rollback. Same actor may restore; other actor cannot see the intent; stale generation ACK not applied. Matching committed or historical removed-ID proof resolves it. Mount/open sends no mutation.
- Historical payroll/percentage/currency snapshots are not rewritten. Old deleted-payment receipt still rejects recreation.

## Local checks

- Existing targeted tests: **49/49 PASS**. Required/malformed public UUID denied before receipt reads/writes/FX; actual web actor getter/precondition and bot route exercised; uppercase UUID canonical replay returned old ID through currency-preparation outage. Ten serialized actual-core calls produced one payment/business audit/outbox/receipt. Removed original returned a matching historical ID and did not recreate.
- Existing finance/stock/logistics/document/cap assertions retained; required UUID fixtures use fixed canonical values. Counter adaptation excludes only the new internal request receipt, not business audit.
- Pure command tests use existing guardedModuleCache helper: lost ACK -> attempt rejection -> restored controller; actor isolation/generation; in-flight coalescing; storage unavailable/corrupt; mismatched ACK; removed original proof.
- Existing **Chromium actual PaymentDialog case PASS**, 2.277 s (test process 3.112 s), 390x844, actual globals.css. UNKNOWN -> cancel/reopen -> transport loss -> full reload -> matching ACK. All three wire requests equal, canonical UUID retained, amount 100.25 USD, manual rate 3.5, rateDate 2026-10-10. Request count unchanged on reopen/reload; FX count remains one while pinned. Fieldset frozen; matching ACK closes and refreshes once. Two screenshots inspected: `.playwright-mcp/payment-command-134/390-normal.png`, `390-unknown-reloaded.png`. Arial fallback, no claim about deployed auth/FX/UI.
- First browser run hit test-fixture pointer interception without CSS; fixture now uses real CSS/keyboard navigation. Initial FX assertion after committed resolution was moved to the intended UNKNOWN boundary; UUID/payload/amount assertions unchanged. Production source unchanged by fixture repair.
- Initial 11 source/10 test paths lint **PASS**; after P1 fix affected source/tests lint **PASS**, zero warnings. Final full strict TypeScript **PASS**. `git diff --check` and strict OpenSpec **PASS**.

## Independent P1 correction

- Review caught all paid-stock failures being rewritten to UNKNOWN. Service now returns confirmed schema/prepare failure before writes, uses accepted133 confirmMutation and the same lock/fresh fence for callback abort/commit ambiguity; receipt IO or failed verification remains UNKNOWN. Typed receipt conflict is not mistaken for IO. Wrapper passes service outcome, and optional effects preserve committed ACK.
- Existing stock inner random UUID was found incompatible with strict internal fields parser; optional validated internal UUID restored, while public UUID remains required and outer stock/logistics guards remain intact. No server fallback or history rewrite.
- Fixed project-scoped restored command now checks payload projectId.
- Affected **24/24 PASS** (existing payment-command/paid-stock-contract/confirmed-action-effects). Two aggregate regressions cover first definite stock refusal -> edited fresh UUID, prior UNKNOWN -> attempt rollback still pinned; actual service known-prewrite/typed-conflict/verified-abort vs receipt/proof IO/ACK loss/cache fault. Business I/O inside service is an explicit DI seam, not native proof. Existing malformed-storage test covers mismatched fixed project without sending.
- Browser previously passed remains current: UI code/UNKNOWN semantics unchanged by service correction; no unrelated browser repetition.

## Proof scope / pending

- DI/controller/component runtime use declared auth/RPC/storage seams. Local GENERAL native completed as detailed below; staging and paid-stock ACTIVE native remain pending. No new stand, matrix or QA framework.
- Independent source review CODE_GO205d99/9501d9 and final GENERAL ACTUAL_LOCAL_GOcd9a3e received; owner authorized atomic own commit. Actual deployed staging actor/replay/outage/paid-stock ACTIVE acceptance remains pending. Main/production untouched. No dump/seed/reset/restic/foreign notification operations.
- SAFETY-RULES D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md read; guard mismatch STOP. Local window released after the single GENERAL run; no SQL repetition.

## Actual local GENERAL native acceptance

- Root ONE + independent EXEC_PROTOCOL_GO76ac90/a00567: exactly one existing `runFinancePaymentNative(safeDb,true)` run on existing local127.0.0.1:5433/pero_crm/public, containerbf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5. RunId68d6ee67-2c85-4383-8f04-3143adbc0134; actual process6.13s, EXIT0.
- Read receipt before document preparation; original ID replay, legacy no-document receipt, deleted original rejection, document ownership/READY checks, cash debit100 BYN, one payment/event, mandatory final receipt failure rollback. Real PostgreSQL constraints/FKs/transactions; document blob storage is an explicit in-memory seam, no outbound delivery.
- Existing helper creates only its own User2/CashAccount/ExpenseArticle/FinanceDocument/Payment/ChangeLog/DomainEvent rows inside its transaction and rolls back the entire fixture. Final invalid-context INSERT is fenced inside a rollback-only transaction even if the expected constraint regresses; no stray unowned row can commit.
- Accepted133/163 guards before constructor, standard guardedModuleCache anchored in real tests directory, no additional Prisma client/ambient credentials. Entire64 original tables + constraints/functions/triggers/indexes digest before/after: b373ec8ec1ab293abc175e1e2e89b9f99f84e4a331dfd22be2b39e0d62fee6d4. Reviewed13-source byte digest a96231fa747cd48b20f580f7786da2d51677e2700772db23fe74b5edaae0cbc3 unchanged before/after. Own fixture fully rolled back, module/network guards restored, client disconnect awaited before CLOSED.
- Private existing journal closure: `.playwright-mcp/revision-acceptance/68d6ee67-2c85-4383-8f04-3143adbc0134/closed.json`; SHA2567367b428a8ee9b387f7d83abd49d52834b5eaeb2e6cc1a3c360dfceaf7a0b737. Root/independent final ACTUAL_LOCAL_GOcd9a3e accepted GENERAL-only proof.
- **Paid-stock native NOT_RUN_ACTIVE_ENV_UNINITIALIZED**: current original WarehouseAccountingState.main is UNINITIALIZED. Existing paid-stock ACTIVE helper was not run, global warehouse state was not initialized or altered, no substitute matrix introduced. Parser/service outcomes retain DI24 evidence; relevant paid-stock native remains an actual-stage follow-up on an approved ACTIVE target after deployment.
- Branch/code are local ready, not a claim of full task/staging acceptance. Native, browser, units and TSC are not repeated after accepted checks.
