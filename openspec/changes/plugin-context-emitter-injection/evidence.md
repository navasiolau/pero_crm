# Evidence

## Scope

Feature/152 от freshly fetched accepted staging c6508448450813450b5dbb6a67d77494c37f6cdb; own worktree D:/Projects/pero_crm_worktrees/improvements-152. Четыре production файла, +9/-6: context factory требует type-only emitter, events/actions/REST command явно передают прежний emitDomainEvent. SDK, queue core/store/worker, Prisma schema/migrations, UI и lockfile неизменны. Runtime context→events удалён; context/changelog/run-log/registry imports просмотрены (1301c7), callback сохраняет actor plugin:<id>. Никаких дополнительных composition wrappers или graph collectors.

## RED → GREEN

Один actual-context/events test с memory persistence boundaries: RED38cc74 exit1 — переданный emitter проигнорирован, sent[] вместо ровно1 plugin-actor вызова. GREENb4869e exit0,1/1: явный callback/actor/settings, permission denial, audit/logger, child ровно1/оба события completed, disabled plugin не вызывается, failure/backoff/retry, internal cleanup не достигает hooks. Context и events исполняются настоящие; Prisma/store/manifest/log persistence controlled, PostgreSQL и внешние сервисы не вызывались.

Два существующих compatibility cases135 — parallel dispatchers и internal events — 2c5c35 exit0,2/2. Начальная попытка5801e8 не стартовала из-за отсутствовавшего generated Prisma client после frozen/offline --ignore-scripts install; это сохранённый environment prerequisite, не production regression. Exact client6.19.3 создан командой `pnpm --filter @pero/web exec prisma generate --schema prisma/schema.prisma` (1d6f53 PASS), без подключения к БД. Source schema не менялась; install25908/f17d8d exit0, версии/lockfile прежние.

## Local verification

- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: session2294/cb7755 exit0, один прогон.
- Scoped eslint4production paths+test с max-warnings0: c650b1 exit0.
- `openspec validate plugin-context-emitter-injection --strict`: e82ada exit0; штатный skip_specs=true для чистого refactor без нового behavior requirement.
- Import smoke использует фактические context/events с памятью; все внутренние buildPluginContext callers обновлены, strict typing проверен. Runtime SDK import в context остаётся type-only.

## Remaining acceptance

Independent review, commit/normal merge и actual staging SHA/health/context smoke ещё NOT_RUN. После интеграции достаточно reuse existing accepted135 transport/target и ограниченный actual context сценарий на staging: readonly settings существующего manifest плюс literal supplied emitter для проверки actor/one call, без globalworker/реальных plugin hook effects. Queue state/delivery contract135 не менялся; прежняя native приёмка не выдаётся за новую. Любой новый scoped event с DB effect — только отдельное RootONE и exact-owned cleanup. Main/production/restic/dumps/newDB/seed/storage effects0.