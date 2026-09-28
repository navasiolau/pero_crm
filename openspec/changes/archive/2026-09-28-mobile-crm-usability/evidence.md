# Evidence

## Состояние

Реализация в `codex/mobile-crm-usability` прошла локальную приёмку и независимое review основным агентом; затем в составе первой волны принята на staging и production в ревизии a1123c5. Локально: 33 PASS / 3 явных SKIP, затем 9 уточнённых сценариев PASS; после отдельного разрешения владельца WORKER 360×800 и MOUNTER 390×844 прошли полный сценарий на одном помеченном проекте и двух задачах, ещё две read-only проверки подтвердили DONE/скачивание фото. Созданные записи и файлы адресно удалены. Актуальная staging/production-сводка приведена в конце; основные specs синхронизированы, change архивирован 28.09.2026.

## Приёмка на существующей локальной БД — 28.09.2026

- Guard подтвердил `pero_crm_pg`, точный container ID `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, volume `pero_crm_v2_pgdata`, bind `127.0.0.1:5433`, БД `pero_crm`, user `pero`. Пароль прочитан из Config.Env только в память.
- Runtime запущен helper `apps/web/tests/browser/mobile-local.ts serve` на `127.0.0.1:3104`, AUTH_URL `http://localhost:3104`, отдельный случайный тестовый AUTH_SECRET; S3/AWS/BOT env исключены. Разрешена только штатная metadata-синхронизация плагинов при старте.
- Авторизация браузера: signed test JWT существующих активных ADMIN/MANAGER/ENGINEER/MANAGER+ENGINEER/WORKER/MOUNTER с реальными id/roles/sessionVersion; `/api/auth/session` подтверждает id через серверную БД. Это не проверка правильного пароля. Тестовый секрет живёт только в gitignored `.playwright-mcp/mobile-local-state.json`, helper удаляет файл при остановке runtime.
- В первоначальном прогоне 33 PASS создание записей и загрузка файлов не выполнялись; формы открывались и заполнялись без submit. Два разрешённых `my.view` проверены/возвращены compare-and-swap; counts и MD5 всех строк 13 бизнес-таблиц совпали. READ WRITE тогда использован только для CAS UI-предпочтений. Последующее отдельное разрешение на точные fixtures и его cleanup описаны ниже; seed/reset/schema push не выполнялись ни на одном этапе.
- Playwright: 360×800, 390×844, 1440×900; светлая и тёмная темы; 36 сценариев дали 33 PASS / 3 SKIP (один worker/photo сценарий на каждом viewport). После уточнения ожидания ошибки входа и дополнительных снимков верх/низ диалогов — 9/9 PASS.
- В исходных существующих данных нет активных назначенных WORKER/MOUNTER задач. Первый фото/drag-сценарий явно пропущен, пустые рабочие экраны этих ролей проверены. Пропуски закрыты отдельным разрешённым ниже прогоном; отсутствие исходных задач не скрывалось.
- В существующих данных нет кассы BYN: финансовая форма показала штатное предупреждение и disabled-кнопку. Проверены `inputmode=decimal`, доступность комментария hit-test, прокрутка до кнопки и отсутствие переполнения. Касса ради теста не создавалась.

### Дополнительный RED → GREEN по реальным данным

Старое сравнение `document.scrollWidth - innerWidth` пропускало переполнение: mobile Chromium увеличивал innerWidth вместе с документом. Новая проверка сравнивает scrollWidth с физическим Playwright viewport; добавлены проверки x/width диалога.

- RED: список проектов и короткий диалог — scrollWidth 944 при viewport 360; длинный заголовок реального проекта — 2822 при 360, desktop — 3086 при 1440.
- Причины: `useIsMobile` использовал innerWidth вместо `matchMedia.matches`; flex-ссылки карточек с `break-words` сохраняли большую min-content ширину; заголовок содержал длинный URL без переносов.
- GREEN: hook использует matchMedia.matches, ссылки мобильных карточек ограничены шириной родителя и переносят длинные слова, h1 имеет min-width/max-width/overflow-wrap без изменения размера шрифта. Исправление не скрывает переполнение через overflow:hidden.
- Личный просмотр выявил преждевременный PNG «ошибки входа»: пустой alert служебного announcer удовлетворял старому locator. Теперь ожидаются точный текст «Неверный email или пароль» и доступная кнопка «Войти»; новые PNG показывают настоящую ошибку.

### Просмотренные PNG

Устойчивые локальные копии: `.playwright-mcp/mobile-qa/before/` и `.playwright-mcp/mobile-qa/after/` (gitignored). В after — 64 PNG; имя содержит сценарий, viewport и исходное имя. Лично открыты и осмотрены обе мобильные ширины: вход, настоящая ошибка, проекты/изделия, светлые/тёмные фильтры и меню, верх/низ формы на высоте 420, редактирование изделия/кнопки, комментарий финансовой формы, длинный заголовок, пустой экран работника. Дополнительно осмотрены desktop таблицы/light/dark, длинный заголовок и оба диалога, затем WORKER/MOUNTER канбан, фото, таймер и выполненные карточки. Физическая клавиатура и камера телефона не эмулировались.

Ключевые пары для независимого просмотра:

- Before `before/projects-360.png` → after `after/mobile-usability-navigation-filters-and-list-cards-mobile-360--projects.png`.
- Before `before/project-short-form-360.png` → after `after/mobile-usability-long-form-fits-short-viewport-mobile-360--project-form-short.png` и `...--project-form-short-top.png`.
- Before `before/project-long-title-360.png` → after `after/mobile-usability-finance-form-keyboard-and-short-viewport-mobile-390--project-long-title.png`.

Runtime 3104 был оставлен для root review. После фактического просмотра основным агентом финальных projects/short-dialog/WORKER+MOUNTER photo/completed PNG и статического diff он разрешил остановку и feature-коммит. Проверены localhost listener и команда процесса PID34860 в этом worktree, остановлен только этот Next; отсутствие listener 3104 подтверждено. Session49841 завершилась; временный signed auth state `.playwright-mcp/mobile-local-state.json` отсутствует. Исходники, screenshots и очищенный fixture manifest сохранены.

## Разрешённый контрольный проект: фото, таймер и завершение

Владелец отдельно явно разрешил один помеченный тестовый Project и две Task в **существующей** локальной БД с последующим удалением только собственных точных ID. Реализован opt-in helper `mobile-owned-fixtures.ts`: UUID manifest сохранён до INSERT; Project.numberInt = -2000000000 не увеличивает max/business-нумерацию, ссылки client/manager существующие, Work/User/Client/Product/CashAccount не создавались. Обе задачи имеют workId=null, estimateMinutes=1, requiresPhoto=true.

- Run UUID: `dfb12841-cbcb-429a-a81a-e95dbaddf0ac`.
- Project: `ac36d89c-b535-4f4f-8b92-a1cc9e4ce233`.
- Task WORKER: `0f503067-9fde-47c5-aac7-1928298d91ec`; Task MOUNTER: `49d28db2-f4a8-493a-b5a3-31eea127e7cc`.
- Перед созданием и каждым timer-действием guard исключил чужие активные и остановленные нулевые TimeEntry: действующий autoStartTimer мог бы менять такие записи. Enabled plugins строго `file-stages`, у него нет event hook; изменение набора означало бы STOP.
- В обоих браузерных сценариях реальный CDP touch-свайп увеличил scrollLeft > 40 без смены статуса. Только ручка имела touch-action:none, её перемещение запускало drag; отпускание в исходной колонке не меняло задачу.
- «Выбрать файл» открыл настоящий file chooser. Два небольших PNG загружены через штатный UI → HTTP 200 и «Фото (1)». Подписанный GET каждого своего File вернул 200/image/png и точный исходный SHA256. S3 отключён, четыре original/thumb файла существовали только под worktree `apps/web/uploads/<projectUUID>`.
- «В работу» создало по одной активной TimeEntry, «Выполнено» дало DONE/doneAt и остановило её с фактом ≥1 минуты; PayrollEntry для обеих задач — 0. Выполненные карточки лично просмотрены на новых PNG `worker-completed-receipt` и `mounter-completed-receipt`.
- Исходный сценарий один раз упал до изменения задачи из-за неверного двоеточия в locator ручки; исправлен по фактическому aria-label. Первое read-only сравнение скачивания ошибочно перебирало оба файла одного доступного проекта; проверка исправлена на точную связь File.taskId из manifest. Это исправления harness, не продуктовые RED.
- Cleanup manifest фиксировал точные ID: 2 File, 2 TimeEntry, 24 Notification, 4 DomainEvent, 6 ChangeLog. Перед удалением повторно проверены связи project/task, отсутствие любых неожиданных Project relations, SHA и realpath файлов. DELETE ограничен exact IDs и принадлежностью; prefix/age-cleanup и каскадное удаление неизвестных связей не применялись.
- После cleanup counts/MD5 всех строк **13 исходных бизнес-таблиц + 5 таблиц TimeEntry/Notification/DomainEvent/ChangeLog/PluginRunLog совпали**. Четыре собственных файла удалены после проверки SHA; только пустые собственные каталоги удалены нерекурсивно. `my.view` WORKER/MOUNTER возвращены CAS. Manifest `.playwright-mcp/mobile-owned-manifest.json` имеет state `cleaned`.

Команды: `mobile-owned-fixtures.ts prepare` → `mobile-owned-actions.spec.ts` отдельно WORKER/mobile-360 и MOUNTER/mobile-390 → две read-only `completed receipt` проверки → `capture` → `cleanup` → `mobile-local.ts restore-prefs`. Существующие данные, роли и пароли не изменялись. Полный повтор этой записи требует нового явного разрешения; helper отказывается перезаписывать существующий manifest.

## Историческая диагностика до уточнения владельца

- Начальный RED, Playwright mobile-360: базовый размер текста 20 вместо ожидаемых 22 px; длинный диалог при 420 px высоты имел верхнюю границу −116 px. Первое падение navigation из-за компиляции/login timeout не считается содержательным RED.
- После первой реализации завершился прогон 12/12 (360×800, 390×844, 1440×900): вход/типографика, навигация/фильтры/карточки, короткая форма, канбан сотрудника/выбор фото.
- Расширенная проверка на 360 px отдельно прошла 4/4: короткая форма, изделие/вкладки/редактирование, финансовая форма/клавиатура, ошибка входа.
- Личный просмотр скриншотов обнаружил дефекты, не покрытые первоначальными assertions: внутреннее переполнение редактирования изделия и перекрытие нижнего поля sticky footer. Введён minmax(0,1fr) для трека диалога, footer возвращён в обычный поток, добавлены проверки внутреннего scrollWidth и hit-test поля.
- До явного STOP в следующем расширенном прогоне успели пройти 6 сценариев; полный результат этого прогона отсутствует.

Эти прогоны использовали отдельную одноразовую локальную БД. После уточнения владельца немедленно остановлены Playwright session 11376 и Next session 72548; отсутствие listener 3104 подтверждено. Fixture/schema/cleanup операции больше не выполнялись. Созданные нами setup-скрипты одноразовой БД удалены из поставки. Существующая локальная БД, staging и production данным worker не изменялись.

## Статические проверки

- TypeScript `tsc --noEmit` — прошёл.
- ESLint изменённых TS/TSX и новых browser-файлов — прошёл.
- Существующие 19 auth-security unit tests без БД — прошли.
- `openspec validate mobile-crm-usability --strict` — прошёл.

## Приёмка первой волны на staging — 28.09.2026

Ревизия `a1123c5f8a498dc916a67e609a4a550720367fc2`; [staging CI #46](https://github.com/navasiolau/pero_crm/actions/runs/36422255188) — success. Штатный cron развернул её в 12:40:31 UTC, приложение healthy, DB identity прежняя. Root проверял реальную staging-копию (1325 изделий/184 проекта); новые учётки и роли не создавались.

- Read-only run `82bb11a9-73d1-4e90-aecd-7ca1d8772dce`: 13 PASS + 1 NOT_AVAILABLE, семь чистых ролей. M+E отсутствует на staging; она прошла локальную матрицу восьми существующих наборов ролей. Counts/hashes 13 бизнес-таблиц + ChangeLog/TimeEntry совпали.
- Browser run `5e5af0c2-481e-4976-882a-8f4f7245288c`: четыре сценария 360 px PASS (проекты/persistence, изделия/persistence, короткая форма, инженерский landing/свои DESIGN). Затем native session 390 FAIL, общий status этого run — FAIL. Четыре prefs точно приведены к принятому baseline, 15 hashes PASS.
- Browser run `b56c73bb-6648-4934-b4a7-0d07175ba1b2`: восемь оставшихся сценариев 390/1440 px PASS; четыре prefs точно возвращены CAS, 15 hashes PASS. В каждом restore: 1 ключ unchanged, 2 restored, 1 собственная вставка deleted.
- Итого **12 сценариев на трёх viewport завершены в двух прогонах; единого 12/12 run не было**. Root лично просмотрел 21 реальный PNG и принял отсутствие body overflow, мобильные body 22 px / input 18 px / высоту input 48 px; desktop body остаётся 20 px (input 17.5 px / 32 px высоты).
- Root просмотрел все семь PNG успешных сценариев 360 px из `5e5af0c2-481e-4976-882a-8f4f7245288c` и все четырнадцать PNG из успешного `b56c73bb-6648-4934-b4a7-0d07175ba1b2`. Ранее просмотренные изображения первого b761 run остаются диагностикой его отдельного сбоя и не превращают его в успешный run.

### Ограничения и сохранность

Первый b761 browser run потерял response bodies. CAS отказался перезаписывать непроверенную ревизию; `disposition.json` фиксирует две оставленные canonical manager-настройки `view=kanban` при исходном отсутствии list/legacy-view строк. Root принял их как новый default baseline без удаления. **Побайтовое восстановление prefs первого run не утверждается**; после двух последующих run все четыре ключа восстановлены точно. Исправление QA — один `route.fetch` и durable capture перед unchanged fulfill; код приложения ради этого не менялся.

Public HTTPS + Basic Auth прошли в браузере. Сессии подписаны для существующих id/roles/sessionVersion; парольный вход — NOT_TESTED. Read-only receipt отдельно не проверял public Basic Auth. На staging формы открывались без business submit; сохранение собственных фильтров — единственная согласованная мутация браузерного этапа. Фото/таймер/завершение ранее проверены только на разрешённых локальных owned-задачах и не выдаются за staging business-сценарии. Физическая камера/клавиатура и будущий 3D-просмотрщик не проверялись.

Санитизированная сводка основана на `.playwright-mcp/staging-first-wave/<runId>/readonly-result.json`, `browser-result.json`, `restore-result.json`, `disposition.json`. Checkpoints, JWT, PII и сами PNG в Git не копируются. Локальная интеграция перед staging дополнительно дала единый 8/8 PASS в `local-list-acceptance/590386f3-1802-4f76-bb81-047d76f8de1e/result.json`, четыре prefs возвращены CAS, бизнес-счётчики совпали.

## Операционное завершение

Root отправил a1123c5 в main после QA. [Main CI #47](https://github.com/navasiolau/pero_crm/actions/runs/36428827890) — SUCCESS, все три jobs зелёные. Production a1123c5 подтверждён: web started `2026-09-28T13:35:26.80154508Z`, scheduled watcher `13:40:05.434559 UTC` — `unchanged`/healthy, штатный HTTP health 200. DB ID/startedAt/mount прежние; прямой production SQL не выполнялся. Снимки: [staging deployment](../../../../deploy/evidence/2026-09-28-first-wave-stage-deployment.json), [production](../../../../deploy/evidence/2026-09-28-first-wave-production.json).

Основные specs синхронизированы, change архивирован 28.09.2026. Эта актуализация документации не запускала runtime/БД/remote операции.


## Завершение OpenSpec

28.09.2026 основной агент сверил все требования и сценарии с основными спецификациями, выполнил strict validation и архивировал change после принятой локальной, staging и production приёмки.
