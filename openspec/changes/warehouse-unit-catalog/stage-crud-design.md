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
