# Design

## Context

Feature62 fresh927. Existing actions.addExpenseArticle/toggleExpenseArticle и ArticlesView управляют справочником; requireFinance центральный. ExpenseArticle связан сPayment черезimmutable id, CashAccount funcs втомжеactions file — чужойscope и не меняются. №58 отдельно добавляетPROCUREMENT вcentralFINANCE_ROLES.

## Goals / Non-Goals

**Goals:** позитивныйуникальныйcode+stableallocation/display.
**Non-Goals:** переименованиеFK, изменениеcash/money/oldPayments/ролей58, физическоеудалениестатей.

## Decisions

Additive Int@unique +SQLCHECKcode>0. Migration20261003020000 даёт missingcodes начинаяпослеMAX(existingcode), ROW_NUMBER ordercreatedAt,id, безactivefilter; thenNOTNULL/unique/CHECK. Existingcoded rows unchanged. НикакогоSQLapply/seed byworker.

Article-onlycore использует existingwithTaskTransaction/globaladvisory lock; автоматическийcode MAX(all)+1, customstrictdigits≤2147483647, duplicateprecheck+DBunique защитавнешнихгонок. Auditcreate insideTX, failure rollsarticleback. Action centralrequireFinance andsafeP2002duplicate message; Accounts неизменны. Toggle сохраняетcode.

QueryView включаетcode и сортируетпоcode; формаprefill основана на полномспискеactive/inactive, numericdigits textinput, code колонкаreadonlyexistingrows. ПредельныйINT безсвободногоnextcode даётяснуюошибку и допускаетcustomunusedcode. No newdependencies.

## Risks / Trade-offs

- [Одновременноесоздание] → sharedtransactionlock+uniqueconstraint, safeerroroutsidefailedTX.
- [Центральнаяrole58ещёнеmerged] → толькоFINANCE_ROLES/requireFinance, nohardcodedPROCUREMENT.

## Migration Plan

Isolatedofflinefrozenignore-scripts deps/ownPrismaGenerate; RED→GREEN domain/UI/SQLshape checks, TC/lint. Rootapplyexistinglocal/staging иactualimage/native/browser acceptance pending. NoGit/DBapply/prod/restic/dumps/reset/seed; SAFETYguardmismatchSTOP.
