# Protocol — input141 / available-PC baseline

Уточнение владельца12.10.2026: iMac окончательно исключён из приёмки. №141 завершается измерениями доступного ПК после оптимизаций; аппаратная причина исходного инцидента не устанавливается. Production/main по-прежнему запрещены без отдельного указания. Старые аппаратные ожидания и расширенные матрицы ниже являются историческим планом, не текущим блокером.

## Исторический статус протокола

Подготовлен source-only private producer; независимый concrete source review и любые actual execution grants ещё pending. Ветка bugfix/141, accepted sourceRoot cd38cb745759becd58dbbad4d6d37afa03f0ab7a. Appsource0, actual benchmark0; own frozen/offline ignore-scripts install1 и compile-only2 IIFE завершены. Next/server/browser/DB/staging calls0. iMac: BLOCKED_DEVICE_UNAVAILABLE. Перед запуском нужны конкретный producer/closure review и rootGO; этот документ не является ExecutionGO. SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch. Main/production/commits HOLD, restic/dumps/reset/seed/newDB запрещены.

## Fixed Workloads

Все объекты synthetic plain data, seed input141-v1; исходные сотрудники/заказы/файлы/storage keys не используются. Канонический UTF-8 fixture JSON имеет SHA256, фиксируемый до первого запуска. IDs qa-project-0001/qa-product-0001/qa-manager/qa-engineer; timestamp2026-10-10T00:00:00.000Z; quantity3, currencyBYN, цены null/1000.00 по фиксированному индексу, coverFile/sketchFile null. Роли MANAGER и ENGINEER измеряются раздельно. Props/fixture ACL не доказывают hosted server-role policy.

| Семейство | Actual consumer | Размер / роль | Область ввода |
|---|---|---|---|
| 1 — поиск142 | ProjectsView+KanbanBoard, ProductsView+ProductsKanban | 100/500/1000 rows на доску; primary500 MANAGER, secondaryENGINEER | Глобальный draft до авторитетных rows; начальный view=kanban, остальные фильтры пустые |
| 2 — обычное поле | InlineTextField, реальные inline-save controllers; product description/project title | Одна запись; MANAGER, собственный DESIGN ENGINEER для редактируемого поля | Текст; внутри серии нет blur/Enter |
| 3 — цена/количество144 | ProductInlineDetails/live sum, ProjectConfirmedTotal | Один product/project, baseline price2/quantity2, BYN; MANAGER | Чередование цифры/Backspace, deltas рендеров description/confirmed-total |
| 4 — select146 | SearchableSelect, MultiSelectFilter | 100/1000/5000 options; последнее enabled значение выбрано, каждый10-й disabled, label+hint | Открытый список при наборе; закрытый при изменении соседнего текста; неизвестные выбранные IDs отдельно |
| 5 — форма143 | Реальные ProductsTab/dialog/миниканбан | 100/500/1000 products, primary500 MANAGER | title/description/price раздельно; без настоящего Create, дефолты и overlay сохраняются |

Для MANAGER projects циклически распределены по STAGES: LEAD/ESTIMATE/CONTRACT/IN_WORK/DONE/RECLAMATION/PAUSED/REFUSED; products по8 PRODUCT_STATUSES, включая DRAFT, с projectStageCONTRACT. ENGINEER products — только собственные DESIGN/PRODUCTION, showAmountfalse. Начальный фактический count rows/visible cards записывается. MANAGER не входит в ADMIN_ROLES: DRAFT скрыты реальной canViewProductDrafts. При цикле status[(i-1)%8] raw500 даёт437visible (63DRAFT), raw100/1000 дают87/875; actual DOM count и positive body control проверяются, raw count не называют render count. Первый grant только для family1 primary500 MANAGER/desktop; остальные ячейки NOT_RUN до конкретного review.

## Build and Source Gates

- Normal: locked React production DOM renderer, NODE_ENV=production, без render counters/Profiler instrumentation. Primary first-family cohort не включает tracing; дополнительный trace измеряет отдельный overhead-labelled cohort после review/grant. Для latency только минимальные CDP/PerformanceObserver наблюдения.
- Profiling: те же исходники/toolchain/workload, специальный установленный production profiling renderer. Положительный control подтверждает настоящий callback Profiler. AST counters стоят внутри выбранных authored render bodies; module path+function name разделяет одинаковые DraggableProduct разных файлов.
- Normal/profiling bundle hashes, emitted minified/gzip bytes и raw input-source bytes из actual metafile записываются отдельно; raw source sum не называется unminified emitted bundle. Initial mount не называется hydration либо typing latency полного CRM.
- Общие163 source pins проверяют accepted physical inputs и каждый exact virtual namespace, transformed bytes, transformer SHA, original blobs; schema/lock/package/workspace/tsconfig/producer pre/post включены. WIP imports и нерассмотренные transforms запрещены.
- До браузера: clean acceptedSHA, source/producer/review bytes совпадают, fixture hash/cardinality/roles верны, initial-render counters положительны. Drift между build/run фазами — STOP.
- Если после baseline принят новый parent, меняющий измеряемые модули/условия, перед142–146 снимается новый immutable baseline на этом parent. Старый результат не перезаписывается и не объявляется сопоставимым автоматически.

## Keyboard Series

Основной viewport1440×900, DPR1, zoom100%, light; CPU/network throttling отсутствует.390×844/360×800 — дополнительные layout, не Android/iOS hardware. Канал браузера заранее задан: bundled Chromium fixture, как в component tests; exact version/headless/flags и доступный Windows host фиксируются. Это не профиль Chrome сотрудника и не его iMac.

После mount/fonts/layout —2s idle. Текст:20 отдельных trusted клавиш ASCII для строки 0123456789 abcdefghi с целевым80ms шагом; фактические timestamps/cadence записываются. Enqueue допускает только80±20ms; просроченный deadline/catch-up burst завершает серию STOP. Замедление DOM processing остаётся измерением и не фильтруется этой границей. Native CDP ACK watchdog5s, общий caller watchdog20s; незавершённые ACK/серии не получают PASS. Измерение не использует fill/paste/insertText. Producer планирует native CDP keydown/keyup пары по wall-clock deadlines, не ждёт предыдущий eventACK перед постановкой следующей пары: медленный обработчик иначе растянул бы серию и скрыл queueing. Проверяются точные20keydown+20keyup+20insertText input, порядок/ASCII data/isTrusted/spacing/final fake-value hash и отсутствие composition. Recorder хранит явные start/end и тот же DOM target; EventTiming фильтруется по entry.startTime, React commits — по commitTime, longtasks — по startTime, независимо от задержанной observer delivery. Инъекция не доказывает скорость физического keyboard/OS stack iMac — такой ввод является отдельным cohort.

Цена/количество: baseline2; до idle добавить3, получить draft23 с постоянным dirty/pending.20 измеренных клавиш — десять пар1/Backspace, валидные23↔231; baseline и pending для confirmed-total144 не меняются. Focus/selection/preparation вне серии. После серии2s idle.5 повторов со сбросом только in-memory fixture; ни один outlier не выбрасывается. Настоящие записи/blur/Enter не используются; fake transports только в памяти.

Отдельные фазы: mount/warmup; immediate typing до последнего paint; post-debounce preference/navigation; ответ с accepted rows. Первый142 grant удерживает authoritative rows во время набора. Delayed response/focus/clear/IME/DnD/ошибки/CAS — отдельные correctness regressions, которые не заменяют timing.

## Metrics

| Stream | Точная запись |
|---|---|
| Условия | acceptedSHA; source/producer/transformer/schema/lock/toolchain hashes; browser/version/flags/headless; OS release/arch, CPU model/threads, RAM, GPU/driver если доступны. Без hostname/serial/IP |
| Данные | fixture hash; rows/cards/options; query/role cohort; viewport/DPR/zoom/font; sourceRoot; controlled transport mode |
| Клавиатура | trusted keydown/input/keyup counts, timestamps/cadence; active field/caret; final fake-value hash; composition state |
| React profiling | root commit counts/distinct commitTime; actualDuration p50/p95/max; body render deltas board/columns/Draggable/commoncards/description/live/confirmed totals |
| Event Timing normal | support/threshold/observer errors; observed keyboard interactionIds/coverage; start/processingStart/processingEnd/duration; per-interaction max; observed-only p95/max; missing/censored/unavailable counts |
| Browser normal trace — separate cohort NOT_RUN | exact version/schema/hash; scripting/style/layout/paint/GC; relevant long tasks>50ms count/max. Full-series input/processing/presentation только при поддерживаемом genuine trace |
| Preservation | value/caret/manual scroll; порядок/геометрия; исходные PNG3viewports; golden не обновляется автоматически |

Percentile: nearest-rank ceil(0.95*n) по реальным наблюдениям;5серий и pooled100keys отдельно. Nested Profiler durations не суммируются поверх root time. Render calls не называют commits. Missing EventTiming entries не равны0ms; observed-only p95 не называется p95 всех20keys. Unsupported metrics остаются null с причиной. Ошибка source/control/keyboard/visibility/closure делает запуск STOP, без удаления missing samples ради PASS.

## Acceptance

-142 начинается после measured family1 baseline доступного ПК. Цель —0 unchanged authored card renders до rows replacement, p95 urgent React update≤16ms в той же profiling сборке; нужны actual values/coverage.
-143/144/146 требуют своих measured baseline, сохранения validation/CAS/ролей/функций и staging desktop/mobile. Virtualization146 вводится только если измеренные cache/memo всё ещё не выполняют бюджет.
-141 требует реального full CRM production build на iMac и сопоставимого быстрого ПК,5families×5runs, trace и повторяемого A/B одного фактора. Микрофризы: отдельный60–90s trace. Только reviewed owned staging fixture для записываемых полей; драйвер/GPU/profile изменения отдельно согласуются с возвратом настроек.
- Критерий №141: доступный ПК,5 families/5 повторов, p95≤100ms/max≤200ms. Физический iMac исключён; текущий normal proxy и исторический profiling/INP не смешиваются.
- Stage read/prefs и stage business-field writes — разные reviewed protocols. Inline blur/Enter является записью; copied production record в component protocol не редактируется.

## Evidence and Privacy

Private ignored run directory содержит UUID/manifests/workload hashes, normal/profiling receipts, bounded traces/PNG. Public evidence — безопасные numbers/counts/hash/status и exact commands, без env/session/cookies/body/response values. Реальные stage traces требуют reviewed private retention/sanitization; внешние upload/telemetry отсутствуют. Owner/CAD/original uploads,18cd38 и3task145 baselines сохраняются. Любой неизвестный network/action/source/target mismatch останавливает запуск без ослабления guard.

## Primary Sources

Дополнительные расходы profiling и actualDuration/commitTime: [React Profiler](https://react.dev/reference/react/Profiler). Event grouping/8ms quantization/threshold censor и timestamp decomposition описаны в текущей рабочей [Event Timing API](https://www.w3.org/TR/event-timing/); конкретный browser проверяется независимо. Трассы приложения читаются по [Chrome Performance interactions](https://developer.chrome.com/docs/devtools/performance/reference#interactions). Источники помогают выбрать instrumentation, не доказывают причину iMac.

## Concrete Private Source Packet

Private source: apps/web/test-results/input141-protocol/reviewed-source-draft.json, packet SHA a33c401a2b00ad892a2a3d3b64bd5339cd8a1d5b1a879f81b52c59137b86d607. Exact14 producer/support files включают caller/builder/runner, pure AST/recorder/metrics/keyboard/dependency/browser-seal helpers, fixture, entry и cold capsules/reference existing esbuild metadata. Все inventory/build/benchmarkApproved=false, настоящий framework/runtime не запущен.

caller проверяет exact sourceRoot/revision/producer bytes и approved common163 hashes до dynamic import. Сначала отдельно reviewed readonly inventory всех own frozen dependency files; его digest одинаков дляnormal/profiling и проверяется до компиляции, onLoad, после неё и перед/после runtime. renderer19.1.0 pin подтверждает package/version/export и оба actual production renderer inputs в полном esbuild metafile. Non-renderer loaded closure обязан совпасть. Browser private adapter4MiB имеет closed output imports и original raw AST SHA, bound to accepted blobs; Node common256KiB wrapper не меняется.

Actual parser/control/renderer compile и browser/dependency inventory требуют следующего отдельного rootGO. Cold source tests28/28PASS используют Node builtins, fake CDP, synthetic timestamp events и уже сохранённый esbuild metadata145; это не measured baseline, real renderer control либо browser acceptance. Unknown action/network/source/renderer/dependency/cadence/ACK mismatch STOP; protected data/window permissions не расширяются. Runtime localhost-only synthetic fixture не имеет Next/DB/production transports.
