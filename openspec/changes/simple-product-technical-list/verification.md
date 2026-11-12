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

Ожидает normal merge/CI/deployment и фактической root-проверки. Production не включён.
