# Stage CRUD design — task 110

## Closed scope

Root ACK: new standalone wire/fixtures/browser/runner and their four pure tests, plus this artifact. Frozen migration-proof entry/runner/tests, common token-clock helper, migration SQL, app code and schema are not edited. Every actual phase is root-owned after deployment identity and migration AFTER acceptance; source checks do not authorize prepare.

## Phases and ownership

- `plan`: guarded RR READ ONLY on accepted candidate; signed PRE holds planned fresh IDs, exact tags, control/schema/business fingerprints and known operational clocks. PRE is fsynced before any write.
- `prepare`: root separately acknowledges durable PRE; one transaction creates four disabled-password actors ADMIN/MANAGER/ENGINEER/DIRECTOR, own Unit A, two active/inactive materials (purchasePrice7/minStock3), own client/CONTRACT project/product quantity1/price0, material need2/issued0 and three null-rate configs. No stock/finance/payroll, plugin events, notifications, file or S3 writes.
- `handoff`: current active actor data checked; short-lived JWTs returned only to private root memory. Cookies, passwords and auth secrets never enter files/log/HAR/traces or technical wire.
- `browser`: compiled Next UI/actions only. A is raw fixture; B is added through UI. Two logical unit tags, maximum three lifetime unit IDs with exact own create-audit lineage. Intent is durable before dispatch; acknowledgment records only bounded technical data. Unknown response stops; capture and explicit recovery cleanup are separate, without action retry.
- `capture`: signed coherent observation of exact own graph, last acknowledged preferences, original complements, schema/control prints and shared clock proofs. All numeric material/norm fields stay fixed; only unit FK/name may change.
- `cleanup`: signed observation+journal CAS, immutable actors/client/configs, dynamic FK/typed/noFK checks. Any unknown reference, field or ownership drift stops the whole transaction. Only exact own IDs and acknowledged composite prefs are deleted; original rows are never reset or restored broadly.

## Actual scenarios

ADMIN page/control visibility, B add and A rename, delete-unused confirmation/cancel; active and inactive references both refuse delete. MANAGER active-material FK swap preserves7/3/norm2/issued0; inactive-only A still refuses delete. DIRECTOR inactive FK swap frees A. MANAGER/ENGINEER/DIRECTOR catalog add/rename/delete denials use correct learned Next actions on an allowed warehouse page, real own JWT sessions and ADMIN same-wire controls, never duplicate/FK/CSRF failures as denial. B may be re-created once for a positive control; all incarnations are journal/audit bound.

## Verification and outputs

Pure controls cover signatures, durable PRE/intents, exact roles/disabled-password flags, numbers, all original table/schema/control prints, token membership/other fields, stable bot value/clock, journal ACK/no retry, unknown FK/noFK references, CAS configs/preferences, technical secret/JWT rejection and wire limits. Root's immutable technical receipts contain no credentials. Actual inventory stocks are covered by accepted migration/native evidence; this kit uses stock0 and creates no warehouse journal or money records. tasks4.3 remains pending until root actual PASS plus cleanup acceptance.
## Deployment evidence before this kit

Root reported actual110 migration AFTER PASS on deployed9b7147409ab512433ffef92ffe8d2778ed42d646: 2119 original materials and all53 original public tables preserved, unit labels/FKs/schema verified, API-token stable fields exact with only measured lastUsedAt clocks changing. BEFORE run57dac892-f9f7-477b-a3fe-02dd33f0126f artifact SHA26bce89497932a4338a6329079e07d318cd25db6444e12e995b6690bbc6709d1; AFTER artifact SHA1dfcfce8f1c6afecbd9fd4ca290e103be039fc7cf4d75f1a292898d291b9981b. These are parent actual evidence, not a new runtime claim by this worker. Fresh CRUD PRE must bind the actual accepted candidate after task113 migration and its source manifest; this kit has created zero actors or database rows.

## Recovery and command contract

Initial journal is fsynced before prepare intent/dispatch. Browser action intent precedes dispatch; pending intent/ACK journal recovery can only record existing durable evidence for read-only capture. Browser/prepare/cleanup intents cannot replay mutations. Marker-only local crashes resume only when exact planned digests/scope match, never by overwriting a record. Unknown prepare and unknown browser response require explicit capture-backed cleanup policy. Unknown cleanup may be confirmed by a read-only full-original/absent-own check; it never repeats DELETE.

Coordinator CLI: `node apps/web/tests/warehouse-units-stage-runner.mjs <phase> <full deployed SHA> <fresh UUID> <absolute apps/web/test-results/unit110-stage-UUID> --authorized`. Plan additionally requires `--migration-after <absolute accepted AFTER artifact> --migration-after-sha256 <exact file SHA>`; prepare requires `--acknowledged-prepare`; cleanup requires `--observation-digest <current signed capture digest>` and, only for known lost response, `--unknown-cleanup`. Build takes only `build <absolute private .mjs output>` and executes no runtime. Every phase needs root's current reviewed scope/identity acknowledgment; these commands are documentation, not permission to run.

New fixture SQL has only source/pure verification here. Root must first complete guarded read-only `plan` on the real accepted candidate (including Material Restrict, successful migration ledger and ACTIVE accounting), review the resulting signed PRE/zero-actor inventory, then authorize exact prepare. Existing native migration/rollback PASS is preserved; it does not claim execution of this new CRUD kit.

## Standalone JWT packaging correction

Root's readonly plan for run7fc56955-d786-4826-9788-366f95f72024 on deployed0ab stopped with ACCEPTANCE_MODULE_DEPENDENCY_MISSING (root operationf2f80c), before PRE/actor creation. This failure stays recorded; prepare/browser was not dispatched and the failed directory is not reused as a successful PRE.

Docker copies Next's standalone trace instead of the whole installation. QA now embeds the exact locked @auth/core0.41.2 JWT implementation and its transitive JavaScript into the ESM bundle. Only @prisma/client stays external. A portable node:module createRequire(import.meta.url) banner resolves native Node builtins in bundled CommonJS, including Node stdin invocation on Linux; no hard-coded Windows path or dependency-guard bypass is introduced. This follows the already accepted111 bundle technique, whose actual private handoff root reported successful on0ab. Cookie salts, roles/sessionVersion, maxAge600 and memory-only handoff stay unchanged.

RED reproduced the missing Auth package in an isolated Node directory containing only a Prisma stub. GREEN cold stdin now reaches the expected input rejection with zero stderr and without constructing Prisma. A separate memory-only synthetic JWT control verifies both directions against the application's actual Auth.js encode/decode for both cookie salts and600-second TTL. Generated tokens and the synthetic key travel only through process memory; they are never written to artifacts/logs. These are local dependency/crypto tests, not staging acceptance. Root must review exact new source/bundle hashes and launch a fresh guarded readonly plan; all physical/W07/dependency/target guards and frozen migration proof sources remain intact.

## Production action reference correction after closed run

Root's fresh planfed4b8 and prepare545edf for cbd7b64c-ec06-4328-9173-15985ad98276 were durable, but browser6bdfa7 stopped at UNIQUE_COMPILED_ACTION_REQUIRED before its first mutation. Journal/actions/preferences stayed0; no Unit B or ChangeLog was created. Root captured the exact scope, then cleanup1e939f returned CLEANED_DURABLE/allOriginalsPreserved. Review1888ae confirmed all54 original tables, the14 initial own row hashes and zero unknown references. The old scope is closed and never retried as browser/prepare.

Root read-only production metadata4f1834/c4469b confirmed unique named Node entries for the four expected exports with filename server/warehouse/unit-actions.ts or server/warehouse/actions.ts, explicit workers/moduleId/async:false and action-browser layers. The current manifest raw SHA is5752fd07950e02688fd176acefa869c0ba2951428525b75eb6b2c49e3b3af547; individual IDs are dynamic and are not hard-coded in QA.

The guarded plan reads only .next/server/server-reference-manifest.json from the current app, projects four typed public descriptors and its raw hash, then signs the projection inside PRE before persistence. Filename, unique export, required worker, known additional compiled routes,42-hex ID, node layer and synchronous worker contracts are checked. encryptionKey and the whole manifest never enter a signature body, wire or file. Prepare and private handoff require the exact signed PRE projection to match the current manifest. Handoff exposes the signed public projection separately from memory-only cookies; the browser uses only these PRE-bound references and no DOM/minifier regex. Target/source/run/revision guards, frozen migration proofs, numbers and CAS cleanup remain in force. A new independently reviewed source manifest and fresh run are required for actual testing.
