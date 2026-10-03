# Design

## Context

Fresh90c69f8 интегрировал58: ACCOUNTANT finance-only, PROCUREMENT office-readonly+finance. ExistingFinanceTab содержитденежныеформы, getProjectEconomics selects onlymonetaryfields/snapshots. Newnamespace avoidsgetProjectFor которыйвыдаётобщиеprojectdata/controls.

## Goals / Non-Goals

**Goals:** separatefinanceworkspace/list/deep-link withsharedfinancialcores.
**Non-Goals:** generalProjectedits, neworgincome61, newrole/schema/migration, изменениематематики/цен/paidfacts.

## Decisions

Corefinancequeries receiveActor andenforceFINANCE beforeDBread, selectmetadataallowlist, explicitlymappublicDTO (includingclientlabelnotphone/address). Pageauth+servercorechecks independent. Projectlookup numberorid, existingcentralidentifiers validated; normalOfficevisibilitynotrelaxed. ListDataTable search/sort+safehref tofinanceproject.

DetailusesgetProjectEconomics/projectpaymentsreadonlyfinanceprojection, activecash/articleoptions; FinanceTabreused forINCOME/EXPENSEconfirmeddelete. SharedformatterEuropeMoscow preventsSSRtimezonedrift. router.refresh onlyafterfinancialACK rereadsdynamicworkspace; scalarinlinecontractsnotchanged. Existingmoney actions centralrequireFinance retainallvalidation/audit and generalproject invalidation.

## Risks / Trade-offs

- [Read access implieswriteaccidentally] → no generalforms/DTO, queryallowlist/negativeACL tests.
- [Newpath notinvalidatedbyoldAction] → financialACKrefreshdynamicworkspace, no unconditionalfieldrefresh.

## Migration Plan

No migration. IsolatedofflinefrozenignoreScripts/ownPrismaGen. RED→GREEN actor/queryboundary/DTO/workspaceintegration tests, TC/lint. Coordinator/root actualexistinglocal/stage acceptance; noDBwrites/browser/SSH/prod/restic/dumpsbyworker.
