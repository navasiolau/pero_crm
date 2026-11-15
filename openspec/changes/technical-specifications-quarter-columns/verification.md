# Проверка №220

Ветка bugfix/220 от свежего staging `14bc907b`. Владелец запросил 25% для названий и 75% для значений.

## Local

- Единственное изменение приложения — значение общей CSS-переменной 25% без md override. Линия, редактор, просмотр и ручное создание берут ту же долю. Сервер/данные/legacy/автосохранение/КП/CI не менялись.
- Уточнён существующий component-browser test, без новых сценариев. Проверены 390/1440, геометрия 25/75 и совпадение линии, полный текст, autogrow/no overflow, прежние ввод/IME/replay и режимы просмотра/создания. Проверка помещения каждого отдельного слова заменена переносом без обрезки по новому требованию узкой колонки.
- Existing browser suite **PASS**, targeted ESLint 0, diff/OpenSpec checks — PASS. Скриншоты просмотрены root. Для CSS-изменения локальная БД не запускалась.
- Независимый GPT 6.1 SOL review — GO, P1/P2 нет. Чужая принятая задача #219 сохранена.

## Staging

**Принят actual staging `a391e5f1df7f307905513df7e1d46a10bee09a01`.** Обычный merge bugfix/220 сохранил историю. [CI 43742834911](https://github.com/navasiolau/pero_crm/actions/runs/43742834911) — **7/7 success**, включая renderer, обе browser-группы, backend/native и выпуск исходных OCI по принятому #219 протоколу.

- Actual web index `sha256:efa32d002a026282a218e99b13dc91d2f3ec0e31e5498abbcbd243f2acee2bd8`, renderer index `sha256:acc0357191f73a0efbb68f571009d622eb7175ceab779f192c6c6f50fb9dad13` совпали с `original-oci-promoted` текущих SHA/run и immutable парой. Web container `6e086589ba41df0560a6a9438f010f27b1627460a50254c813a2c7ccf53ea196`, healthy. Штатный W07/watcher не менялись; DB ID/volume/StartedAt сохранены.
- Root проверил **390/1440 × светлая/тёмная**, реальный service worker разрешён. Во всех четырёх измерениях CSS-переменная 25%, сетки названия/значения 25/75, общая линия 1 px совпадает с границей; полный текст и высота 320 px сохранены, горизонтального переполнения нет. Снимки просмотрены root.
- Приёмка выполнялась на существующем активном Product: обе серверные операции prepare/inspect в `SET TRANSACTION READ ONLY`, без новых сущностей/CRUD. Browser открывал только прямую карточку, не фокусировал/не менял поля, разрешал лишь два известных read-only действия. Четыре текстовых hash одинаковы; хэш всех scalar полей выбранного Product, включая JSON/старое описание/updatedAt, до и после совпал. **0 browser errors, 0 запрещённых write attempts**.
- HTTPS health — HTTP 200/database ok. Remote main остался `30473e7f8bca76e843f1ec34580bcb5ca7133f5b`; production не выпускался. После приёмки отчёт фиксируется только в ветке задачи, приложение staging остаётся на принятом SHA.
- Независимый итоговый SOL audit actual evidence — GO для изменения пропорций №220: совпадение OCI/runtime, четыре геометрических измерения, отсутствие бизнес-записей и неизменность выбранной строки подтверждены.

Приватные evidence: `.playwright-mcp/task220/ci.json`, `publish.log`, `deploy.json`, `prepare.response.private.json`, `inspect.response.private.json`, `browser/result.private.json`, четыре PNG, `health-final.json`, `staging-final.json`. Cookies/env не коммитятся.
