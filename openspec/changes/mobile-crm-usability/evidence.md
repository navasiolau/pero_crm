# Evidence

## Состояние

Реализация в `codex/mobile-crm-usability` прошла локальную приёмку и независимое review основным агентом; push и staging-приёмки нет. Выполнена повторная локальная приёмка на существующей БД владельца: 33 PASS / 3 явных SKIP, затем 9 уточнённых визуальных сценариев PASS. После отдельного явного разрешения владельца пропущенные возможности проверены на одном помеченном локальном проекте и двух задачах: WORKER 360×800 и MOUNTER 390×844 прошли полный сценарий, ещё две read-only проверки подтвердили DONE и скачивание фото. Все созданные записи и файлы адресно удалены, исходные данные сверены. Staging остаётся отдельным незавершённым этапом.

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

## Требуется до приёмки

- Приёмка точной staging-ревизии, затем фиксация результата/архивирование. Физическая камера телефона и будущий 3D-просмотрщик текущими проверками не охвачены.
