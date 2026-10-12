# Design

## Context

Мотивация — proposal.md. Planning155 остаётся в existing feature/155/improvements-155 от fresh origin/staging d121f0798e963f32d13f52c9bde57c0aa82b7929. Задача159 принята на staging по сведениям root;160 имеет локальный commit678, но её staging-приёмка ещё pending. Ни один из этих фактов не является разрешением реализации155: нужен отдельный concrete ROOT_SCOPE_GO и выполненный dependency160 gate.

Initial и повторный current readonly census проверили1240 source/config/script files,1199 TS/JS AST через immutable TypeScript5.9.3 из зависимостей153 (compiler SHA3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675). Обход включает source/tests/scripts, bot, packages/plugin exports, deploy и.github; generated/private directories исключены. Приложение, Server Actions и Prisma clients не исполнялись. Оба deterministic census дали одинаковый SHA27c3d86e8dcffec252c3b733a129f0e9f45691a0cf00c284c7aa3cc41de4f391.

Actual findings: один runtime import внутри candidate group, два test imports и ноль найденных внешних production/type-only/reexport/literal dynamic consumers. Unknown production computed import()/require() для checked traversal не найден. Это source inventory; результат production compilation/tracing не получен.

## Goals / Non-Goals

**Goals:**

- Удалить ровно девять source modules общей длиной781 physical LOC/30776 UTF-8 bytes и только их obsolete test dependencies.
- Сохранить actual FileGridView SSR contract/setup, пять contact-controller blocks, warehouse validators и historical getProjectFor semantics.
- Подтвердить unchanged active UI/data contracts в локальных checks и actual staging acceptance, без подмены этого source-инспекцией.

**Non-Goals:**

Удаление Communication/history моделей, строк или миграций; изменение readers/ACL/audit/финансов, CSS/theme library, raw Prisma fields, новые dependencies, расширение legacy cleanup, фикса iMac. Source LOC не означает уменьшение executed JS. Source app/test edits, removal, generation, full typing, commits и runtime сейчас не разрешены.

## Decisions

### Exact source allowlist

Все девять существующих source files предлагаются к DELETE после scope/prerequisite approval; остальные source paths неизменны.

| Path | Physical LOC | UTF-8 bytes | Boundary |
|---|---:|---:|---|
| apps/web/src/components/ui/drawer.tsx |228|11584| Только local wrapper/11 exports; Base UI package и другие active components не удалять. |
| apps/web/src/components/ui/breadcrumb.tsx |125|2711| Только wrapper/7 exports, без изменения navigation/layout. |
| apps/web/src/app/(app)/products/[id]/surveyor-link.tsx |56|1709| SurveyorLink и unused SurveyorInfo, без изменения staff/project/product models/readers. |
| apps/web/src/components/file-image-thumbnail.tsx |14|1032| Только orphan component/ThumbnailFile; FileGridView, FileViewer и защищённые file routes сохраняются. |
| apps/web/src/lib/inline-phone-dependency.ts |12|1467| Orphan helper/ConfirmedPhoneClient; current project-contact-controllers и inline save не менять. |
| apps/web/src/lib/warehouse-input.ts |1|133| Только unused reexport bridge; четыре original server/warehouse/contracts schemas остаются. |
| apps/web/src/app/(app)/projects/[id]/history-tab.tsx |160|5803| Только unused presentation; historical data/model/reader остаются. |
| apps/web/src/app/(app)/projects/[id]/communications-tab.tsx |117|3988| Только orphan presentation и unused CommunicationRow; no DB-row deletion. |
| apps/web/src/server/communications/actions.ts |68|2349| Только единственный addCommunication export; ни schema, ни notification/history data не очищаются. |

Эта группа имеет28 runtime/module exports (включая четыре warehouse reexports) и четыре type-only declarations. Исчезновение reexport bridge не означает удаления actual validators из их оригинального модуля.

### Consumer exceptions and disconnected chain

| Owner | Target | Classification |
|---|---|---|
| communications-tab.tsx:18 | server/communications/actions.ts/addCommunication | WITHIN_ALLOWLIST_CHAIN: оба конца входят в девять; outside production caller не найден. Это закрытая цепочка, а не ложное утверждение, что каждый target имеет буквально0imports. |
| file-image-thumbnail.test.ts:6 | FileImageThumbnail | TEST_CONSUMER; убрать только этот import и orphan block, весь mixed file сохраняется. |
| inline-phone-dependency.test.ts:4 | resolvePhoneDependency | TEST_CONSUMER; все три blocks посвящены orphan helper. |

SurveyorLink/старые имена в negative guards и historical docs — text-only упоминания, не runtime consumers; guards не удалять ради нулевого RG output. Current source/type-only/dynamic/plugin exports сверяются ещё раз перед реализацией; любой новый outside caller означает STOP и scope review, а не автоматическое переписывание caller.

### Exact test allowlist and block classification

Два изменяемых test paths:

- apps/web/tests/inline-phone-dependency.test.ts — DELETE весь16-line файл с тремя orphan blocks;
- apps/web/tests/file-image-thumbnail.test.ts — MODIFY: удалить только import FileImageThumbnail на baseline line6 и последний one-line orphan block на line17; сохранить имя файла, remaining imports/setup/fixture и live block14–16. Не добавлять зеркальный test и не переименовывать mixed file.

Итого implementation source/test scope11 paths: девять source deletions, один orphan test deletion, один mixed test edit.

| File / baseline lines | Block | Decision |
|---|---|---|
| file-image-thumbnail.test.ts:14–16 | all shared file lists show only original filename and disabled trash without image requests | KEEP_LITERAL/setup: AST body SHA2b95e596b82e60f70410d18ffb3a77db348302ed4d136346323cafb6f3962fef. Реальный FileGridView, оба flat variants, filename/disabled-trash/no-image assertions сохранить. |
| same:17 | nonimage thumbnail adds no image fetch and filename download/view is unaffected | REMOVE_ORPHAN: AST SHA53649f5fb6d0ce8028857ecd3e44de1a718a91fa2b970ed94bd56db1258f7e87. Это rendering только удаляемого component. |
| inline-phone-dependency.test.ts:5–10 | phone waits for local client save and conflicts instead of writing to old client | REMOVE_ORPHAN_HELPER; действующие binding/FIFO/ACK проверки сохраняются в contact controllers. |
| same:11–13 | failed client save blocks dependent phone without losing its expected target | REMOVE_ORPHAN_HELPER, without deleting current failed-flush/draft preservation tests. |
| same:14–16 | confirmed same client keeps its exact binding for normal phone CAS | REMOVE_ORPHAN_HELPER, current contact CAS/control code остаётся. |

Все пять blocks apps/web/tests/project-contact-controllers.test.ts целиком KEEP_BYTE_IDENTICAL:

- lines7–16: client switch waits for delayed contact ACK and binds only canonical new contacts;
- lines17–21: failed contact flush preserves input and blocks selection request;
- lines22–26: server refresh cannot bind old drafts to another client or erase pending input;
- lines27–31: binding conflict cannot rebase a contact onto a different client;
- lines32–37: clean server renders replace canonical contacts and unchanged legacy empty phone permits selection.

Их code hashes сохранены в census.details; test file не входит в editable allowlist. Перед/после требуются literal body equality и bytes setup/fixture/imports, исключая ровно один утверждённый import и one-line obsolete block.

### Protected historical and current contracts

Без изменений: server/projects/queries.ts, getProjectFor и его nested include/return projection, options.includeHistory behavior, Communication/ProjectStageHistory/ProductStatusHistory/ChangeLog schema+stored rows+migrations, source labels, ACL и active writers других доменов. Existing reader при includeHistory не false читает communications, stageHistory и product statusHistory; при false сохраняет своё текущее сокращение и fallback semantics. Эти данные не объявляются несуществующими из-за удаления старой вкладки.

Также KEEP: server/warehouse/contracts.ts, project-contact-controllers.ts, project-inline-provider, actual project/product pages, files-tab/FileGridView, FileViewer/FileList routes, project-client-readonly-contacts, product-single-page/negative SurveyorLink guard, current file-list/printing/plain-list suites. Нельзя удалять Base UI/Tailwind packages, values/validators or helpers лишь потому, что входящие зависимости одного candidate исчезли.

### Acceptance and measurements

1. До edits: подтвердить root dependency160 STAGING_ACCEPTED revision и concrete SCOPE_GO, guard ветки/base/source SHA/consumer census/absolute path/reparse, сохранить exact approved source/test blocks and protected bytes. Не запускать DB backups/reset/seed.
2. После edits: exact11-path diff, девять files отсутствуют, outside editable/protected bytes unchanged, remaining live FileGridView/setup literal comparison и contact-controller five-block equality. Expected source−781LOC/−30776bytes; candidate tests33→15LOC (−18), obsolete blocks4 removed и one live mixed block retained; плюс пять untouched current-contact blocks. Actual counts проверить после implementation.
3. Local: affected retained FileGridView/contact/readonly-contact/inline-save/file-list/printing/product-card/navigation tests; full type graph/lint и appropriate build после root resource slots. Source/DI/typecheck не заменяют actual card/runtime checks. No real financial/document writes ради QA.
4. Bundle comparison: frozen actual before/after production build manifests/chunk metrics нужны до обещания executed-JS/CSS savings. Удаление Drawer/Breadcrumb может изменить Tailwind generated utilities; visual checks required на1440×900/390×844/360×800. Пока CHUNKS/CSS_DELTA/EXECUTED_JS NOT_MEASURED.
5. Root normal merge→CI→actual staging revision/image/health and affected cards/files/contacts/navigation/limited-role privacy. До этих receipts STAGING_NOT_RUN. Historical reader/data invariants проверяются отдельно по реальным evidence; source snapshots не объявляются DB-row fingerprints.

## Risks / Trade-offs

- Whole mixed suite удалена → запрет whole-file deletion, exact import/block allowlist и FileGridView/setup hash proof.
- Historical Communication/history данные удалены вместе с UI → explicit model/row/migration/reader exclusions, no DB mutation in cleanup.
- Closed-chain incoming import ошибочно сочтён live root → classify communications-tab→action внутри source allowlist отдельно от outside entry.
- Новый type/dynamic/plugin consumer появился → current candidate/integration graph + STOP; не расширять scope автоматически.
- Utility CSS изменился несмотря на orphan JS → actual production CSS/chunks comparison и browser viewports, external library versions untouched.
- Удаление объявлено performance fix без измерений → source footprint отдельно, JS/CSS/latency NOT_MEASURED до actual metrics; iMac incident не закрывается.
- Чужое WIP скопировано → работать только в155 branch, ordinary root integration,153/156 commits и other workers preserved.

## Migration Plan

Миграций нет. Existing proposal/design/tasks проходят independent scope review. После concrete root SCOPE_GO и160 staging-prerequisite: feature/155→local→independent CODE_GO→owner-authorized atomic commit→root normal merge staging/CI→actual staging acceptance. Main/production не разрешены.
