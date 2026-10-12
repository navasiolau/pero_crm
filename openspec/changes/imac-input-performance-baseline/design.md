# Design

Уточнение владельца12.10.2026: iMac окончательно исключён из приёмки. №141 завершается измерениями доступного ПК после оптимизаций; аппаратная причина исходного инцидента не устанавливается. Production/main по-прежнему запрещены без отдельного указания. Старые аппаратные ожидания и расширенные матрицы ниже являются историческим планом, не текущим блокером.

## Context

См. proposal.md и root-plan141/142–146. Доступный sourceRoot bugfix/141 чистый на acceptedcd38; actual iMac отсутствует. Уже установлены source-level цепочки: draft поиска обновляет родителя доски; форма ProductsTab хранит title/price/description рядом с карточками; ProductInlineDetails слушает полный price/quantity snapshot. Это основания для замеров, не причинный диагноз iMac. Текущий baseline-source содержит старый focus145; профиль использует неполный текстовый запрос, который не требует автоматического центрирования.

## Goals / Non-Goals

**Goals:** воспроизводимые available-PC component baseline для142–146, зафиксированные source/workload/build/host conditions, отдельная оценка browser latency и React work, честная полнота наблюдений; подготовленный paired full-app/iMac протокол.

**Non-Goals:** исправление приложения в141, изменение ролей/CAS/денег/данных/внешнего вида, Next/build/native/staging без rootGO, изменение драйверов/Chrome profile/cache/service workers/аппаратного ускорения, эмуляция iMac CPU-throttling, аппаратный диагноз по быстрому ПК. No specs: diagnostic tooling/docs, skip_specs true.

## Decisions

1. Две отдельные сборки реального UI: normal React production для latency/trace и специальная production profiling для commits/actualDuration и render-body counters. Dev build не измеряет основной бюджет; normal/profiling результаты не смешиваются. Local component createRoot с controlled Next/server boundaries не называется full Next production/hydration/staging acceptance. React profiling имеет дополнительную стоимость и требует отдельной сборки; actualDuration относится к дереву текущего update, commitTime группирует commits. [React Profiler](https://react.dev/reference/react/Profiler).
2. Использовать неизменённые accepted production files только из clean sourceRoot. Общие163 pinSources/assertSourcePins/declared virtual adapters (после их code/protocol GO) фиксируют полную actual compiler closure, producer/transformer SHA, schema/lock/config/toolchain до/после compile/run. Любой physical import из WIP127/145/135/130, неизвестный namespace или source drift — STOP до браузера. Runtime import paths вычисляются от caller/sourceRoot, без hardcoded author-worktree.
3. Считать исполнения реальных authored render bodies (включая DraggableCard/DraggableProduct и общие карточки), а не вызовы внешней observer-обёртки: обёртка могла бы срабатывать при memo bailout настоящей карточки. Private AST instrumentation вставляет только counter в известные function bodies, сохраняет module/props/hooks/return и имеет reviewed transformed-byte descriptor с original accepted blobs. Только profiling build. Неизвестное/переименованное тело или отсутствие положительного initial-render control запрещают выдавать renderCount0.
4. Данные deterministic/synthetic и закрытые fake transports; никаких auth cookies/live records/PG/S3. Normal UI/controls/CAS draft controllers остаются реальными; заменяются только Next/server transport boundaries. Server saves/navigation разделяются на immediate typing и post-debounce/RSC phase. Unknown action/URL запрещён. Raw traces private ignored; публичный receipt содержит count/timing/hash, без field values/headers/cookies/PII.
5. Начальный coordinated window ограничен family1 globals142:500rows, MANAGER,1440×900,2boards, normal и profiling,5×20keys. Это минимальный доказательный baseline соответствующего сценария.100/1000rows, ENGINEER и остальные families расширяются отдельными reviewed configurations после первого результата; фиксированная полная матрица в protocol.md, никто не объявляет эти непройденные ячейки завершёнными.
6. Event Timing record coverage и trusted keyboard count проверяются явно. duration имеет8ms granularity; observer threshold ниже16ms не даёт полного массива быстрых взаимодействий, поэтому отсутствующие entries не записываются нулями. Per-interaction max события группируется по interactionId; observed-only p95 отдельно от полной серии. Input/processing/presentation-delay approximation и limitations подтверждаются фактическим API/trace данного browser version. [Event Timing API, текущая рабочая спецификация](https://www.w3.org/TR/event-timing/).
7. Baselines/fixtures/build conditions сохраняются immutable с hash и повторяются после142–146. Допускается только предусмотренное исправление по отдельному change, viewport/размеры/отступы/labels/caret/DnD/черновики сохраняются. Source145+128 интеграционные search/role regressions принимаются отдельно после обычного merge; данные в141 не копируются между ветками.

## Risks / Trade-offs

- Затраты instrumentation → normal и profiling два независимых result streams, одинаковая instrumentation before/after только для render counts.
- EventTiming censor/missing paint/hidden tab → coverage/visibility/trusted-event checks; unavailable latency не заменять0 и не закрывать бюджет141.
- Изменение CSS/шрифтов/данных между runs → workload/hash/viewport/font/browser/source pins и immutable pictures; Arial component wrapper отдельно обозначен, реальный app Onest требует полной приёмки.
- Другие Node/build/CPU задачи на доступном ПК → root quiet window, warmup/actual key spacing записываются; contaminated series сохраняются с причиной, не удаляются выборочно.
- Version-specific Chrome trace fields → parser сначала проходит frozen synthetic negative capsules, неизвестный schema сохраняет RAW_PRIVATE/UNAVAILABLE, не fabricated p95.
- Два refs с одинаковым HEAD и разными файлами → physical accepted-root load guard и actual compiler metafile, название ветки не proof.
- Разные роли/объёмы дают разные поля → отдельные cohort IDs; disabled/hidden поля не получают выдуманные measurements.

## Migration Plan

Миграции/production deployment нет. Planning → independent protocol review → source-manifest/producer/capsules review → root coordinated component window → immutable measured baseline; затем отдельные142–146 ветки. Full Next/staging и paired iMac phase требуют своих reviewed source/target/owned-write guards и root window.№141 принимается по согласованному доступному ПК: p95≤100ms/max≤200ms; аппаратная причина и физический iMac не являются предметом приёмки.
