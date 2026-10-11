# Design

## Context

См.proposal.md. Base bugfix/142 fresh acceptedcd38; source scope согласован,141 immutable controls/outputs не редактируются. Actual baseline c5e07/CLOSED20series/full400interaction coverage/8 authored bodies:500project/437product cards, normalp9572/64ms, profilingrootp9542.10/41.60ms,10000/8740card-body calls на20keys. Это available-PC component scope; physicaliMac/fullNext/stage remainNOT_RUN.

Read-only installed DnD6.3.1 confirms useSensor memo[sensor,options], useSensors descriptor dependencies, useCombineActivators[sensors,handler], InternalContext memo[activators,…]. New options objects therefore invalidate context consumers; card memo alone cannot solve that path.

## Goals / Non-Goals

Goals:0authored unchanged Draggable/common-card calls immediate typing AND post-debounce before replacement rows; same-profile urgent rootp95≤16ms on same family1 conditions. Input value/caret and immediate stale-focus cancellation continue; new rows/roles/status/amount/activeDnD changes visibly update without stale caches.

Non-Goals: feature/policy changes, server/financial/CAS/retry redesign, virtualization, form143/select146/price144, source128actor or145readiness copying, CSS/DOM changes, data migrations, deps upgrades, main/prod promotion. Current rights remain unchanged and later integrated128/145 require jointregression.

## Decisions

### 1. Stable data columns and shallow memo

Both boards compute current grouped column rows with useMemo keyed by displayed state rows and relevant role/status collection. Existing filter-by-status grouping stays readable and typed; it runs when rows/roles change. Same array/object references flow to memoized StageColumn/StatusColumn and DraggableCard/DraggableProduct. React default shallow comparison; no custom equality omitting fields. Changed DTO objects, showAmount/canManage/role-target predicates and active drop indicators still render.

Only3production paths:
- apps/web/src/app/(app)/projects/kanban-board.tsx: existing grouping/columns/draggables and onOpen memo boundaries.
- apps/web/src/app/(app)/products/products-kanban.tsx: same, visibleStatuses role memo, stable canDrag predicate, current onOpen.
- apps/web/src/lib/list-params.tsx: stable current-query getter backed by existing controller.getSnapshot, exposed by useListParams.

Alternative memo on common card only leaves Draggable/hooks/context/filter/map work; measured authoredDraggable cost requires a boundary before it. A shared generic Kanban framework adds abstractions and role/navigation plumbing beyond this atomic scope; grouping is a small local useMemo around current expressions, not duplicated new domain logic.

### 2. Stabilize sensor options without changing gesture contract

Same module-level PointerSensor options object(distance8), same sensor/class/useSensors, activation/ARIA/overlay/cancel/drop paths. No extra keyboard sensor, bypass or delayed input. DnD context still changes during genuine drag and updates memo consumers normally. Callback grouping preserves empty columns, original order and keys.

### 3. Read latest controlled query at navigation event

Products board stable onOpen useCallback uses stable getQuery() from controller.getSnapshot().query only on click. It passes existing globalProductsHref/productDetailHref, preserving current normalized controlled query during pending preference save and before RSC. It does not capture query once, read raw location as replacement, write refs during render, reset filters, or alter controller lifecycle. Project open callback remains project-id navigation.

Getter identity depends only on same mounted controller; hook's normal query/pending/revision subscriptions remain. Metadata API does not expose mutators/controller outside existing context. Callback dependencies include router/getter/actual role predicate deps; no suppression of ESLint exhaustive dependencies.

### 4. Preservation and targeted tests

Real React/current checkout fixtures with precise source closure, not a memo observer substitute. Reuse existing kanban-search-focus-browser and relevant role/navigation/controller suites; add typed tests only for meaningful extra cases:

- stable getter identity + current query on same old callback after pending save/new filter/reset/back and late own/conflict/RSC responses; full returnTo/context through wrapper and cover click;
- immediate typing20keys + paused>300ms word/space, clear/reenter, old rows/missing exact/filter axes/Sheet/activeDnD; inputcaret maintained and stale focus canceled immediately;
- unchanged rows produce0Draggable/common-card body calls; new DTO rows/status/title/price/quantity/amount visibility and role/canManage changes update content/drag/drop; DRAFT filtering currentpolicy;
- real gesture success/confirmed rollback/unknown handling/cancel/overlay; editor pending drafts survive parent controls;
- joined128/145 checks after root merges: assigned engineer/role unions/status return plus atomic applied row/role readiness. Do not backport their WIP into142.

Before golden anchors: stage18cd38 and task145local3 remain immutable;141 normal/profile desktop PNG pairs byte-identical. Save142 samefixture3viewports before any sourcechange under separate browser GO, compare after actual UI pixel/geometry; never rewrite golden forPASS.

### 5. Matched measurable before/after

Original c5e07 baseline/old14/6ace2IIFE fixtures/render/toolchain/binary hashes retained. After performance uses same dataset/roles/query/prefetch/style/Arial/viewport/DPR/cadence/keyboard, genuine profilingbody inserts and same reviewed7seams/AST4instrumentation policy, normal/profiling cohorts separate. No thresholds hidden via otherdataset/hardware/throttle. Source141 seals require accepted clean production inputs: do not weaken them for WIP142. Local reviewed pending-diff component check needs an explicit owned source-variant seal/base+reviewed diff or wait accepted candidate; standalone local evidence labelled WIP if used, stage after only actual deployedacceptedSHA. Concrete supporting adapter/protocol goes independent review/rootGO before measurement.

Budget includes no drop of slow samples, genuine EventTimingcoverage/missing semantics, root unique commits and authored body counts. Report real values and delta to10000/8740 baseline. If primary budget misses, profile focused remaining work within142 design; scope expansion before code requires updatedreview. Otherfamilies/iMacremain pending.

## Risks / Trade-offs

- Stale navigation captured by memo → stable getter reads existing controller at event, async/reset/back/late response tests.
- DnD internalcontext ignoresmemo → stable sensor options and measured actualauthored body controls, real active gesture tests.
- Stale role/row/financial visibility from aggressive compare → defaultshallowprops/full deps, typedrole/RSC/data changes, no deep/custom comparator.
- Performance counted at wrapper rather than body → existing141AST bindings inside actual authored functions, real profilingrenderer positivecontrol.
- Parent integrations change measured inputs → root preserves versionedanchors, reassess/redobaseline only if conditions/source meaning change; code changes remain separate branches/ordinary merge.

## Migration Plan

No migration. Localtargetedchecks/actualbrowser/profiling, independentdesign/code/protocol reviews; owner разрешил необходимые коммиты; после code review root ordinary merge staging/CI/exactdeployedSHA/render/role/desktop+mobile acceptance. Main/production prohibited. Rollback only this behavior-preserving feature with agreed followup; no reset/copy/cherry-pick or data operations. SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md, STOP guard mismatch; no restic/dumps/seed/reset/newDB.
