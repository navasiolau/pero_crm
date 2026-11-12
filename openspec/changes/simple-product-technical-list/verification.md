# Проверка исправления №216

Владелец 12.11.2026 прямо потребовал заменить отвергнутый конструктор простым полем списка и ограничить перенос из КП. Code candidate `a24727783add7ea7bdca6f9a2e0718f0df4671ac`, обычная ветка bugfix/216 от свежего staging `517eb563`.

## Local

- Девять постоянных пронумерованных строк сразу видны; в поле нет кнопок, select, details, исходного текста, description/size/note, статусов успешного сохранения. Создание изделия использует тот же список.
- Автосохранение после 400ms, без blur/дополнительного действия; IME, очередь, retry того же UUID, независимый CAS/поколение/ID и flush сохранены.
- Product-only projection пропускает только соответствующие характеристики; неизвестные блоки и общие поля КП остаются в полном источнике. JSON/SQL schema прежние, миграций нет.
- Targeted server/access **28/28**, template **54/54**, controller **4/4**, новый browser suite PASS, существующий create-dialog PASS. Полный web прогон дал 1407 PASS и три старых UI ожидания конструктора; после их адаптации соответствующие UI suites и CI scheduling повторно **8/8 PASS**. Финальные TypeScript, ESLint (0 errors) и production Next build — PASS.
- Первая сборка остановилась на нестабильном ответе Google Fonts; повтор той же сборки без изменения зависимостей/шрифтов успешен. Изменение ширины выявило обрезку textarea; autogrow исправлен ResizeObserver/fonts.ready и учётом границ, повторные 1440→390→1440→390 проверки PASS.
- Root на compiled local 32216 / существующей БД 5433 выполнил first empty input, фактический saved ACK с сохранённым фокусом, reload, независимые поля/многострочную фурнитуру, повторный save КП и очистку отсутствующих значений. Actual readback: один JSON с body=«QA Дуб матовый», hardware=«QA Петли», description/size/note=null, неизвестный материал исключён. Полный источник КП сохранён.
- Desktop/mobile PNG просмотрены root, все textarea после resize вмещают полный текст. Повторный финальный прогон после autogrow — PASS. QA проекты/КП скрыты по exact receipts, own web остановлен.
- Независимый review GPT 6.1 SOL — GO, P1/P2 не найдено. В CI добавлена только маршрутизация нового browser suite в существующую Chromium cohort; gates/мигратор/W07 не меняются.

Приватные evidence: `.playwright-mcp/task216/`, `apps/web/test-results/technical-list-216/`. Credentials/cookies в Git не включаются. Инструкция агента уточнена в repo и установленном references/fields-and-pricing.md одной согласованной строкой о Product-проекции, owner-дополнения сохранены.

## Staging

Первый CI `43233012350` для merge `4b7461f9` выявил преждевременный runtime-import ProductCore в native test helper: он загружал transaction adapter до scoped-подмен остальных тестов. Исправление только в трёх harness/caller файлах: type-only import и явная передача уже изолированного модуля. Проверки реального commit/rollback/locks/replay не ослаблены, код финансов/задач не менялся. TypeScript и isolated import proof — PASS.

**Принят actual staging `056969826149e4492dd77d1cabcb5613b629915c`.** [CI 43235891083](https://github.com/navasiolau/pero_crm/actions/runs/43235891083): **7/7 success**, включая обе Chromium cohorts, backend, real native PostgreSQL/HTTP/S3 и публикацию испытанных OCI.

- Web `sha256:e2ce60dea4b8008e8651c6bfaed6219eb9617b8faac353c130873dc193438ff7`, renderer `sha256:504a9a055d99016acb33f735eccf84ac4d79a44ef4813f141c1a189fd8dc49c3` совпали с опубликованными CI index digests. Guard до/после подтвердил SHA, healthy, прежние DB ID/volume/StartedAt, неизменный W07.
- Загрузка renderer сначала превысила timeout; затем watcher остановился на отсутствовавшей digest-привязке старого web в Docker cache после перемещения discovery-тега. Под workflow lock догружены точные CI immutable refs, восстановлены refs старого/нового web без изменения контейнеров; исходная функция kp_binding проверила обе пары. После этого штатный W07 успешно выложил версию. Guards, watcher/config и DB не менялись, проверки не отключались.
- Root выполнил через реальный HTTPS ввод EGGER в пустой «Корпус», дождался настоящего saved ACK при сохранённом фокусе, проверил reload и независимые «Фасад»/многострочную «Фурнитуру». В списке ровно девять сразу доступных строк, ноль button/select/details/input и служебных пояснений.
- Настоящее сохранение КП заменило ручные значения правильными body/hardware, очистило отсутствующий фасад. Actual DB readback: один JSON только с body=«QA Дуб матовый», hardware=«QA Петли», description/size/note=null; неизвестный материал и общие поля не попали. Полное КП сохранило исходное description и остальные сведения.
- Desktop 1440 и mobile 390, все textarea scrollHeight<=clientHeight после resize/fonts, screenshots просмотрены root — PASS. Первый QA-проход потерял доступ к CDP response body после удаления временного action iframe; harness исправлен захватом одного upstream ответа до передачи неизменённых bytes, код приложения не менялся. Полный повтор на свежем QA комплекте — PASS.
- Финальный QA UUID `c4683411-53b9-4203-93b9-15ce96a0eda3`; оба stage комплекта скрыты по exact receipts, файлы/история сохранены. Final health HTTP200/database ok. Local own service client удалён только по ID/метке при отсутствии ссылок, local PG возвращён в прежнее stopped, own web остановлен.
- Remote main `30473e7f8bca76e843f1ec34580bcb5ca7133f5b`, production не выпускался. Этот отчёт фиксируется после приёмки в bugfix/216; staging остаётся на проверенном SHA.

Приватные evidence: `.playwright-mcp/task216/ci-current.json`, `deploy-verified.json`, `renderer-prefetch.response.private.json`, `web-refs-proof.json`, `stage-final-*`, `stage-final-c4683411-53b9-4203-93b9-15ce96a0eda3/browser/`, `stage-readback.json`, `local-cleanup.json`. Credentials/cookies не коммитятся.
