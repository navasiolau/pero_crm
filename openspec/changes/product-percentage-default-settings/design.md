# Design

## Context

Feature42fresh02d7db1. OrgSetting genericunique key/valueJSON достаточен, migrations нет. CurrentcreateProductCore единственныйweb/botcreate path подwithTaskTransaction globaladvisory lock и не создаётpercentageConfigs, значит начальныеNULLrates. Widgets41 другойowner.

## Goals / Non-Goals

**Goals:** scopedsettings + transactionalnewProductdefaults.
**Non-Goals:** существующиеProductbackfill, recipientdefaults, изменениеmoneyformulas/immutablepay/adminsettings, зависимости/schema/visualQA.

## Decisions

ОдинOrgSettingkey productPercentageDefaults stores strict{revision,rates}. Missingkey→revision0/ALLNULL, malformedstoredJSON failclosed безугаданнойставки. Decimalcanonicalstrings с0.1precision0..100, NULL/0 раздельны. UpdateexpectedRevision+expectedRates+clientMutationUUID, audit внутриexistinggloballock, no-op nochange; staleconflictвозвращаетcurrentvalues. Одинsettingrow гарантируетconsistentthree-rate snapshot, не три несогласованныеkeys.

createcore читаетdefaults одинраз послеvalidatingproject/assignee идоProductwrite, creates three configs revision1 nestedcreate внутриTX. Нетparticipants/earlypay/oldproduct update. PerProduct revisions используютсяexistingUI42freefields, текущиеengineer не обязанывыбраныдоcreate.

Exactauthroute /settings/product-percentages (включая trailing slash normalize) допускаетMANAGER_ROLES; parent/adminpages/payroll/modules/api remainADMIN_ROLES. Navbar отдельныйscopedlink дляmanager, adminsettingslanding добавляетsection; serverpage/action independentlyauthorize. Frontendтриfields/explicitsave typedCAS, missing blankNULL, clearerror/currentconflict безсамовольногоперезаписыванияdraft.

## Risks / Trade-offs

- [Oldtestfixture OrgSetting payrollmock returnsBYNforanykey] → updatefixture exactkeyfilter, неproductionfallback guessing.
- [Managerprefixwiden] → exactroutehelper+tests users/modules/payroll/api/unknownsubpaths denied.

## Migration Plan

NoDBmigration. RED→GREEN settingsrights/CAS/defaultnull/0/newcreation/rollback/nooldmutation tests, TC/lint. Root guardedruntime/stage acceptance; noDB/browser/Git/SSH/restic/dumps/newDB/seed/reset/prod fromworker.
