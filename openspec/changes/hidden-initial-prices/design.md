# Design

## Context

Provisionalf33 planning в24; root реальный26tree после25merge. Actual baseline products/core create/update/patch читают/пишут initialPrice, projects/core и bot ordinary paths тоже допускают поле. Schema Product/Project initialPriceDecimal nullable существует. Это окончательная26задача, без импортера КП.

## Goals / Non-Goals

**Goals:** immutable firstexplicitprice for eligible newProduct и closedordinarywriters.
**Non-Goals:** oldNULLbackfill, Projectautofill, валютнаямиграция, historypay rewrite, PDFextraction.

## Decisions

Additive durable marker Product.initialPriceCaptureEligible boolean defaultfalse для existingrows; application newcreate явноtrue до первого capture. Не использовать initialPriceNULL как доказательство новизны. При create explicitprice включая0 snapshot устанавливается и marker false; при missingprice markertrue. Under existing lock/CAS first successful expectedPrice write если markertrue и snapshotNULL ставит initialunitprice и markerfalse атомарно с mutation/audit/receipt; subsequent edits unchanged. Null не explicitprice,0 distinct; Decimalstrings/rounding existing helper. Если snapshot ужеnonNULL marker не разрешает overwrite.

Strict DTO rejects initialPrice во всех new/create/fulllegacy/inline/bot paths; не silentstrip. Удалить UIinputs/validators/payload старых forms, Project также rejectordinaryinitialPrice. Internal readonly consumers сохранить; удалить server-autofill ProjectSUM если существует, currentNULL остаётсяNULL. Attachments nevertriggercapture.

Migration только defaultfalse marker без pricebackfill; legacy snapshots untouched. Neweligiblecreate marker явно устанавливает сервис, не externalcaller. Zero capture tested наcreate/patch/fullwriter under realCAS; auditfailure rollback marker/snapshot/currentprice. Idempotent receipts не захватывают повторно. Native/compiled tests root толькосущественные, не megaQA.

## Risks / Trade-offs

- [OldNULL mistaken new] → durable defaultfalse, exactmigration tests.
- [Hiddenfield still acceptedbot] → addressallentrypoint regression explicitreject.

## Migration Plan

Root freshfeature26 после25merge/basicaccepted; additive marker existinglocal/stage без dumps/restic/newDB/reset/seed. Domaintests/type/build/smallsmoke/actualstageSHAimagehealth. После26 complete comprehensivevisual20–26 отдельныйuncheckedfinalQA. Main/prod/priceimports внеscope, guard mismatchSTOP.

## Actual Branch Context

Root после fresh fetch создал feature/26 от originf33f574 в modernization-26. Прежняя planning в24 была provisional; теперь это фактическая локальная ветка. Независимая параллельная localimplementation разрешена владельцем. Перед интеграцией root ordinarymerge свежего предшествующего staging (для25 после24, для26 после25), сверяет source/contracts и проходит basicactualstage gate. Fullvisual после26 остаётся unchecked; sourceworkers changes не затронуты.

## Final Essential Context

Actual26HEAD110dda81 ordinary25merge resolvedkeep25layout/hideinitial, root835web/bot19/type/lint/BUILD26PASS/migration1financialpreserved/native5all43rollback. Actualstage25/26 pending; comprehensivevisualafter26unchecked/mainnotauthorized. Task32loginaccessblocker recorded separately inevidence, nofakeXLSX.
