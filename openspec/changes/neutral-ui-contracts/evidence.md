# Evidence

## Result

Задача153 подготовлена для независимого CODE_REVIEW_READY в feature/153 от d121f0798e963f32d13f52c9bde57c0aa82b7929. TaskDetails перенесён дословно в lib/task-details.ts, FileListItem — в lib/viewable-file.ts; все 15 type-import consumers используют нейтральный путь. Два обратных server→components рёбра стали нулём. Final scope — 12 source / 4 existing test imports. Mapper, SQL, ACL, UI handlers, schema и lockfile не менялись; сокращение JavaScript не заявляется.

## Local checks

- Единственная owned offline установка: pnpm11.10.0, 724 added / 721 reused / 0 downloaded, --frozen-lockfile --ignore-scripts, 13.4s, session11144 / exit0. Lockfile до/после b33d80beda2a48e643e96a09640fca98d3b1d88570c3af0eba21b84eb1c1c9cc.
- Собственный Prisma6.19.3 client generated с engine=none для типов и mock tests: 355ms / exit0. Cached существующие6.19.3 engine bytes проверены до/после; внешние binary downloads отключены loopback mirror, autoinstall выключен. Это не production/native runtime proof.
- Семь существующих suites: file-list-view, work-shares-settlement, engineer-access, task-file-list, task-work-reward-ui, plain-file-list, file-list-printing. Фактически 50/50 PASS, 0 failures/skips, 2958.67ms / exit0. Это DI/SSR/access/serialization assertions на mocks; не native/browser проверка. DATABASE_URL процесса временно указывал на запрещённый loopback1; настоящая БД не использовалась.
- Full TypeScript --noEmit --incremental false: session75550 / exit0, собственный TypeScript5.9.3. Во время этой проверки source не изменялся. После неё был удалён только unused FileListItem type-import в task-dialog; root признал fresh emit/AST/lint достаточной проверкой этой стираемой строки, полный TSC повторно не запускался. Source этой полной проверки соответствует промежуточному after-emit.json, а final — after-emit-v3.json.
- Final lint всех16 изменённых source/test paths с --max-warnings0: exit0, 0 errors / 0 warnings. Первый lint до удаления unused type-import имел одну warning; исходный lint.log сохранён. Успешные full TSC и final lint дали пустой stdout перед status marker, поэтому PowerShell Tee-Object не создал typecheck.log/lint-final.log; фактические tool/session references и наблюдаемые exit/status записаны в tool-observations.json без повторного запуска или выдуманного logfile.
- Final AST inventory actual src/tests: ровно по одному определению DTO, 15 нейтральных type-only imports, 0 server→components contract imports. Bot/packages сейчас этих DTO не используют; это absence inventory, не bot runtime-приёмка.
- Final TypeScript executable emit: все 15 существующих source/test файлов byte-identical исходному baseline; оба interface declarations дословно совпадают, включая комментарии, optional/null и порядок полей. Новый task-details.ts эмитирует только export {}. Options одинаковы, maps/comments исключены явно; source-map equality или full Next build не заявляются.

## Proof artifacts

Ignored артефакты находятся в apps/web/test-results/contracts153; в коммит не включаются.

| Artifact | SHA256 |
|---|---|
| before-sources.json, 15 physical/Git pins | 7bf2d23d4aa1ef017df99949e10bfc4c26763308fe037d841a1427716bce369d |
| before-emit.json, own compiler5.9.3 | 763148c60619e933bef208265b0d89d0fbae392792379ed93d11f99b9fd0bda9 |
| after-emit.json, intermediate source | cf5eb2c4a856cf0c000c8fbcff51973de2178d537a275bdb92b799e7625d1506 |
| after-emit-v3.json, final source | 7893435ed3272b6858d193b7d04028d67e489833bd000ac45d7ea5fee97e4055 |
| final-type-inventory.json | f14ff5856b692e1d59501f19255b647032295fa3c1295da206de1c13702bcabf |
| tool-observations.json, actual result references | 830b17d48a78a789385e10273b3c3253e61ff21db4d63d13929afb57b5dda824 |
| final16 source/test packet | 4375dccc188e43686917bb51c510e5ff61da73530fb24a82b5aed1917f052356 |
| verifier-v1, preserved | 9dd1d6be41aea8ff8f1a23dd96fe0466f9757966b13576536e03e41d79ef28c5 |
| verifier-v2 | 5aca6f077feb96a8a60aaebf6f4a0a29b1f7ed25d37bd2cde48ba23e3b889539 |
| verifier-v3, final | 02f698de6e9306074e7b3f5bef4bcf90903c1e80cb28a9f194f8c8b277483a83 |

v1 остановился перед emit comparison: configFilePath: undefined в текущих TS options отсутствовал в frozen JSON. Это QA metadata serialization difference; original helper и verify-stop-v1.json сохранены. Root разрешил v2: единственное undefined property явно проверяется, обе стороны сравниваются в одинаковом JSON представлении, реальные compiler/config SHA сохраняются strict. После unused type-import удаления создан новый verifier-v3 и отдельный final receipt; старые результаты не заменялись.

## Limits and delivery

- Новое сравнение полного TaskDetails JSON: NOT_RUN_OPTIONAL по явному уточнению root достаточного локального набора. Partial DTO assertions не объявляются full JSON capture; неизменность runtime mapper доказана точными executable bytes.
- Real DB/native, browser, Next full build: NOT_RUN_OUT_OF_SCOPE для локального дословного type-only переноса.
- Independent CODE review: CODE_REVIEW_GO для source packet4375dccc188e43686917bb51c510e5ff61da73530fb24a82b5aed1917f052356 и final emit7893435ed3272b6858d193b7d04028d67e489833bd000ac45d7ea5fee97e4055; замечаний нет, qualification typing75550 принята. Root разрешил атомарный коммит153 по прямому разрешению владельца коммитов всего плана; его фактический SHA фиксируется Git и передаётся root после commit. Push/merge: NOT_RUN. Staging acceptance: NOT_RUN; фактический SHA/image/health и затронутые read-only сценарии принимает root.
- Main, production, infrastructure, restic, дампы, seeds/resets и соседние ветки не изменялись.
- Finance-агент задачи147 уведомлён о возможном import-hunk conflict tasks/queries.ts; при ordinary merge сохранить neutral type import153 и независимую query logic147, затем проверить интеграцию.
