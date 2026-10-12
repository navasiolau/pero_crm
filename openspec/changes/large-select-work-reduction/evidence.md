# Evidence — задача 146

LOCAL_ACCEPTED, STAGING_NOT_RUN. Own worktree improvements-146, branch bugfix/146, parent 465a59d0709edabf4396a966bb53cd76868f7b86. Production scope: searchable-select.tsx, multi-select-filter.tsx, новый use-options-filter.ts. Один существующий browser test расширен; CSS/server/API/schema/dependencies/task-payment UUID paths не менялись. Все свои browser/pages закрыты; DB/Next/staging effects 0.

## Measurement

Available Windows PC, обычный Chromium renderer и монотонный browser clock. Native pressSequentially с заданной паузой 80 мс, 5 серий ×20 ASCII клавиш на каждый case. Assertions проверили точный текст/20 trusted keydown событий, target и finite второй RAF. Метрика — native keydown → второй реальный requestAnimationFrame; это не EventTiming/INP и не React render duration. LongTasks выбираются по startTime внутри серии.

Бюджет: p95 ≤100 мс, отсутствие длинных задач >50 мс. Оригинальный before/after запуск из base 465a59d сохранён неизменным: 1200 клавиш, 12 cases, EXIT1 из-за after Multi/5000 longtasks. Файл metrics.json имеет статус MEASURED, не PASS.

| Справочник/виджет | Before p95, мс | Cache/memo p95, мс | Longtasks after |
| --- | ---: | ---: | ---: |
| 100 Single | 23,5 | 25,4 | 0 |
| 100 Multi | 24,4 | 24,7 | 0 |
| 1000 Single | 21,8 | 19,9 | 0 |
| 1000 Multi | 42,3 | 30,2 | 0 |
| 5000 Single | 55,5 | 28,3 | 0 |
| 5000 Multi | 200,0 | 42,5 | 5 (150–168 мс) |

Это фактическое основание окна только для Multi. После первой виртуализации отдельные 100 клавиш дали p95 22,8 мс/max 32,2/0 longtasks; этот source pin не обозначается финальным. Визуальная проверка обнаружила неверный шаг мобильных строк из-за zoom-scaled getBoundingClientRect; исправлен только getter на untransformed computed height. На измеренном source pin после layout getter, до последующего P2 keyboard fix, целевой повтор: **100 клавиш, p95 25,2 мс, max 31,7 мс, longtasks 0, EXIT0/CLOSED**. Остальные уже прошедшие случаи не повторялись.

Сохранены только числовые count/p95/max, записи longtasks и три source hashes до/после. Per-key raw timestamps не сохранены, поэтому независимый пересчёт p95 из артефакта невозможен; он подтверждён выполненным кодом и TAP, не отдельным сырым trace. Root принял этот предел без повторного запуска. Итог не утверждает исправление специфического iMac; устройство исключено владельцем.

## Functional and appearance

Существующий project-filter-component.test.mjs: **8 функциональных PASS** после добавления windowed Multi. Закрытый соседний ввод не вызывает map/filter/find по options; single hint/disabled/clear/selected caption вне query сохраняются. Старые project/product role filters, unknown IDs, immediate toggles/reset, scroll remain covered. Large Multi: ограниченный DOM, Tab/ShiftTab через границу окна, Space, мышиная прокрутка удерживает focused checkbox, поиск последней записи и unknown ID сохраняются.

На one-line layout правке выполнены целевой budget и actual CSS appearance; 8-functional suite была до этой type-equivalent правки. После P2 выполнены только затронутый keyboard case, full strict TSC и scoped lint, без повторных performance/visual матриц.

Последняя appearance проверка: **3 пары 1440×900/390×844/360×800 PASS, cleanup AWAITED**. Точные visible controls/text/classes/font/color/geometry и RGBA popup content совпали. Whole RGBA на 390/360 совпадает; desktop whole-image equality false: отдельно принят trigger boundary raster delta (19 pixels, максимум 1 channel unit, без сдвига geometry). Root и независимый reviewer приняли этот критерий; CSS/fixture/golden не менялись. Это один React fixture с globals.css/Arial, не полный CRM/mobile staging screenshot.

## Commands

Из own worktree, только pnpm и существующие инструменты:

- pnpm --filter @pero/web exec node --test tests/project-filter-component.test.mjs — 8 functional PASS, manual timing test skipped.
- CRM_SELECT_BENCHMARK=1 + pnpm --filter @pero/web exec node --test --test-name-pattern='manual available-PC picker budget' tests/project-filter-component.test.mjs — full 1200-key measured EXIT1, сохранён как основание virtual scope.
- Дополнительно CRM_SELECT_LARGE_MULTI_ONLY=1 на том же command — final 100-key EXIT0, session 65278, 11,7 с; resources CLOSED.
- CRM_SELECT_STYLE_PARITY=1 + pnpm --filter @pero/web exec node --test --test-name-pattern='manual actual CSS large picker viewport parity' tests/project-filter-component.test.mjs — final 3 pairs EXIT0, session 7133, 13,3 с; resources CLOSED.
- pnpm --filter @pero/web exec node node_modules/typescript/bin/tsc --noEmit --incremental false — PASS (после virtual implementation, до final layout getter).
- Scoped ESLint three production paths/existing test — PASS; final Multi/test lint PASS. Package/lock/config не менялись.
- openspec validate large-select-work-reduction --strict — PASS; повтор после doc finalization записывается в local packet.

Env flags показаны как обозначение запуска; в PowerShell они задавались локально в дочернем процессе. Новый runner/registry/source inventory не создавался.

## Immutable artifacts

Под apps/web/test-results/select-work-reduction/ (ignored):

- eb856509-932e-407c-9414-c19955508a21/metrics.json — SHA256 e97c77b34722a6802dd2dcc5dc5a921ac2e18d79b6abc8ae7fa4716893f1dd14, полный before/cache результат с нарушением бюджета.
- 9d61c284-f4cc-4821-bf11-8f36c8dff308/metrics.json — SHA256 529c63352c6dd5bf2fbc1ef6a81b120d7fcc20a47d9c1c9741fa52ac3456d6cd, промежуточное windowed измерение, старый source pin.
- 446181dd-15a8-415e-a7dd-38af03a08314/metrics.json — SHA256 7418be87649effe46f0b40d1f499ab1b67cb3da6666b12d5af172003f3504cd1, final target budget.
- 29021a29-484c-4456-8f75-3663a37e0b82/appearance.json — SHA256 1d8192468b42d6f89890cc075bfa1de9eeb679cd79b63fd6f11833980ee50a8c; шесть before/after PNG рядом, их integrity hashes в local-verification.json.

Production SHA256 измеренного состояния до P2:

- searchable-select.tsx: 03c7dc70459dc8b977307db840b4a96437e6dd592845587ca61739d6e7a12759.
- multi-select-filter.tsx: 67d8a3bdef6d31349301ef564dea1294c7249f7accd6f365b2f7edf294bc9b81.
- use-options-filter.ts: 4c0932bc141798764abc70e55ded127d42a122839e30ebd98363227bff58cb84.

Independent final review принято (845879); Root integration/CI/real staging остаются NOT_RUN. SAFETY-RULES D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md прочитаны, STOP при guard mismatch; main/production/restic/dumps/reset/seed/newDB запрещены.

## Independent-review P2 correction

Reviewer обнаружил нарушение natural Shift+Tab: pinned первая строка добавлялась в конец DOM. Числовая сортировка indices сохраняет логический порядок; absolute positions не меняются. Actual counterexample b58c30 дополнительно показал уход фокуса в Popup: eager onBlur reset удалял offscreen focused checkbox, и установленный Base UI Popover restoreFocus='popup' возвращал фокус контейнеру. Убрано только eager удаление last pin; максимум одна дополнительная строка сохраняется до next checkbox/query/unmount.

В существующий large-multi keyboard case добавлен scroll-to-bottom при focused option0 и строгий Shift+Tab→Reset. Используется тот же scroll метод harness, что в прежнем retention case; ожидание не заменяет assertion. Итог 5464e3: 1 targeted PASS, 1,15 с, browser awaited CLOSED; исходные window-edge Tab/ShiftTab, Space/unknown IDs и last selection также выполняются. Предшествующие FAIL сохранены в tool output, не обозначаются PASS.

Full strict TSC session34100 завершён EXIT0 db5f6e после P2; scoped Multi/test lint и diff check c889f4 EXIT0. Финальный Multi SHA256 18af0e67fe54addaca4436546cd041ec958923f91f1a54458ca3b37c4de73f2c. Single/hook unchanged. Новых performance/visual запусков нет: числа 25,2 мс/max31,7 и три appearance pairs остаются историческим proof состояния 67d8a3…, а новый delta меняет только DOM order/last-pin lifetime. Current source и исторические measured hashes разделены в local-verification-p2.json.

## Final independent review

FINAL_CODE_COMMIT_GO + ACTUAL_LOCAL_GO845879 получены для packet0b68d960:9currentpins/10immutableartifacts match, P2keyboard/fullstrictTSC/lint/strict accepted. Historical measured source/25,2ms/appearance явно отделены от текущего DOM-order/last-pin delta; новых benchmark/visual запусков нет. По явному разрешению владельца всего плана — атомарный commit только девяти own paths. Main/production не разрешены, actual stage acceptance остаётся pending.
