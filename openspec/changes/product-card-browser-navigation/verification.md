# Проверка задачи160

Base cd38cb745759becd58dbbad4d6d37afa03f0ab7a, branch feature/160. Scope только QA/test/docs/OpenSpec; source/package/lock/schema/CI diff0.

## Local

- Actual Chromium153.0.8010.12, React19.1.0, Playwright1.63.0:4/4 tests PASS,12.3s.
- Baseline и AST-equivalent formatting: project/global, trusted cover и отдельный неинтерактивный body/title, каждый ровно1правильный product.number/returnTo route; fullscreen0.
- Real PointerSensor/DragOverlay в обоих contexts: preview disabled, trusted drag gesture и native disabled DOM click() не вызывают navigation/fullscreen/server actions. DOM click() не считается trusted event.
- Real mobile project/product tables: CardNumber160/160.1/160.2 visible.
- Two behavior faults×2contexts: после actual mount/ready/trusted click NAVIGATION_MISSING или TARGET_MISMATCH. Provenance accepted, build/hash refusal не mutation-killed.
- Keep4+ProjectSSR:9/9 PASS. Cold import/network-deny/missing-browser checks входят в4/4gate.
- Scoped ESLint через неизменённый pnpm shim PASS; Windows direct CLI без штатного NODE_PATH не считался lint PASS, версии не обновлялись.
- Matrix check PASS:19contracts,18dispositions,27targets,324testFiles. Изменена ровно1disposition row.
- OpenSpec strict иgit diff check PASS.

Новые файлы MJS, в существующем TS только удаление mixed block/fs import. Independent reviewer подтвердил, что full-app tsc для данного scope не требуется; он NOT_RUN, production type contracts не менялись.

## Preservation и provenance

Raw Git LF и рабочий CRLF различаются. Literal physical-Git KEEP4 equality не заявляется. Read-only git check-attr text/eol/filter=unspecified, произвольных clean filters нет; canonical Git blob первых4cases a9a7ff727eaf16557c1a3be265e2ceb35aee9dbe, AST SHA f917a3296665e6d856e93f8809e7d7c4d1f0e0549e41f1af09a2d43a16bef27d совпадают с исходным prefix после удаления только fs import. Первоначальный writer сохранил physical prefix из рабочего файла; независимого pre-edit physical capture нет.

Immutable actual runtime receipt:
apps/web/test-results/product-card-navigation/b19cfbfe-1f08-4402-acb7-744210f155dd/receipt.json
SHA9940cdb6d284a4bf14e4d3cade55714b5f1177d7171c5bc5698c6ae7edf20680.
Measured/current producer SHA0baea95aa5b33bbc9802deb77f49c88b6ca73244897ee81acb936730e76b7da8.
Fresh proofv2 вtest-results/product-card-navigation/source-final-proof-v2.json; first proof refused only LF/CRLF mismatch, source не нормализован.

Каждый runtime variant имеет full actual metafile/source/config hashes до/после. Browser иHTTP server awaited-close; PASS artifact записан после cleanup. Два ранних QA failures (TS factory signature/image preview allowlist) не получили runtime/mutation PASS; собственные процессы закрывались, production не менялся.

## Review и staging

Independent CODE_REVIEW_GO: actual diff/producer/receipt/mutants/cleanup, KEEP4canonical/AST, scopedlint/Node9 verified. Root разрешил exact atomic commit160. Commit не является actual staged proof.
Staging NOT_RUN до root normal merge/CI/accepted image и reviewed readonly project/global cover/body navigation. Profile/CAS changes требуют своего reviewed scope. Main/production запрещены; source guards/migration tests, остальные mixed suites и historical159 raw не удалены.
