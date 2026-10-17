# Staging QA — №176, 17.10.2026

## Result

**STAGING PASS: LIGHT + DARK.** Оркестратор независимо просмотрел receipts/PNG и подтвердил обе темы: 23 сценария / 27 PNG light и 4 сценария / 8 PNG dark. Обе темы также прошли локальный сценарий. Все обязательные пункты приёмки №176 выполнены.

## Deployment

- Ревизия: `e742e2e18014191ac03551ff2730f112749b38bb`.
- CI `38993731208`: все 6 проверок SUCCESS, подтверждено оркестратором до GO.
- Фактический здоровый образ: `sha256:a884efc14c37ce948b022c9ac3952b0895c3ef7f12280ea096dd9e1f4e94232e`.
- Web: `466f3f88a3a8b5eab20f6d27845fd42c022e8dceb696d4003f2ef82909745b4e`.
- Существующий DB-контейнер: `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`; запуск `2026-09-23T11:42:14.649193151Z`, том `crm-staging_pgdata`. W07 и эти признаки совпали до и после проверки.

## Browser and preservation

На настоящем staging с существующим активным администратором проверены проект №205, изделие №215.3 и изделия внутри проекта №215. **23 сценария, 27 PNG**, viewport 1440×900 / 390×844 / 360×800:

- Все три канбан-контекста имеют кадр 4:3, `object-cover`, центрирование и отсутствие полей. Detail и fullscreen сохраняют `contain` и текущие оригиналы.
- В проектах и изделиях реальный initial saveListPreference response получен, ACK записан, а его доставка браузеру удержана до первого ввода после hydration. Подтверждены `pending=true`, сохранение ввода, последующий точный поиск и фокус; отдельно прошло очищение и повтор после ACK. Удержания ограничены по времени и сняты в finally.
- Настоящий service worker включён. SHA256 публичного `/sw.js` во всех трёх контекстах совпал с файлом внутри guarded image: `046616f393b6ae6c2e7124d5073569830357b15ece1ab6225a2b9035396fb783`. Проверен controller `/sw.js`.
- Ошибок page/console/HTTP — **0**, запрещённых запросов — **0**. Реальные DnD/status/business mutations не выполнялись; разрешены только 8 собственных подтверждённых сохранений предпочтений и ID-pinned read-only getBellData с точным `[]`.
- Все 8 изменений предпочтений возвращены обратной CAS-цепочкой к исходным строкам. Снимки сделаны в RepeatableRead. **Все 64 стабильные карты таблиц совпали**, digest `89072e534d9b548f5a01d87dd1f6e31e4394dc440397a3f3f723e9ff7a9fa7fc` до и после.
- Полные строки ApiToken имеют одно изменение `lastUsedAt`: полное число строк (3) и хэши всех остальных полей совпали. Это отдельно сохранённое runtime-наблюдение; таблица целиком не исключалась. В браузерном журнале `/api/v1/*` нет; внешний источник использования токена не устанавливался.
- Все browser contexts и браузер закрыты. Main, production, restic, дампы, reset/seed и новые стенды не использовались.

## Evidence and review

Корень артефактов: `D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/staging176/run-e89f6974-c62b-465f-b3ff-67b8a26fafa0/`.

Оригинальные `receipt.json`, `baseline.json`, `after.json`, `preservation-diff.json`, `token-timestamp-observation.json` и приватная ACK-цепочка сохранены. Auth/basic/session значения в артефакты не записывались. `bundle-provenance.json`, `remote.bundle.mjs` и `controller.source.mjs` фиксируют инструменты проверки.

Оркестратор самостоятельно просмотрел receipt, `product-focus-1440.png`, `product-focus-360.png`, `product-detail-360.png`, `project-fullscreen-390.png` и подтвердил light staging PASS. Дополнительный визуальный просмотр субагентом охватил desktop/mobile обложки, nested-карточку и полные оригиналы.

Прежние HOLD-прогоны сохранены без изменения: прямой JWT import отсутствовал в standalone; Secure-cookie вариант не соответствовал native cookie mode; отдельный ранний прогон имел полное изменение ApiToken и ошибку Serwist из-за Playwright SW block. Последняя ошибка воспроизведена локально с точным хэшем и устранена в QA включением настоящего SW. Старый digest-only HOLD остаётся missing preservation evidence и не переименован в PASS.

## Dark smoke

На том же e742 / image a884 отдельно прошли **4 сценария, 8 PNG**: канбаны проектов и изделий при 1440×900 и 390×844. Receipt: `D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/staging176/dark-run-751bdf4d-ddaf-4920-b2fa-a439438fbadb/receipt.json`.

- Тёмная тема выбрана штатной кнопкой; проверены `HTML.dark`, текущее React-состояние и DOM-подпись кнопки светлой темы. Геометрия 4:3, crop по центру и фокус совпали с ожидаемыми.
- Producer SHA256 `ec50ebab3085795870b5c089ab8f9da1839e4086ea5bdf2141bd3f81f93c1f06`; исходник сохранён рядом. Оба service worker совпали байтами с файлом guarded image, controller подтверждён.
- Ошибки page/console/HTTP — 0; запрещённые запросы — 0; read-only Bell — 4. Все 2 собственных ACK восстановлены обратной CAS-цепочкой, все **64 стабильные карты совпали** с тем же digest `89072e534d9b548f5a01d87dd1f6e31e4394dc440397a3f3f723e9ff7a9fa7fc`. Полные карты и отдельное изменение одного ApiToken.lastUsedAt сохранены; внешняя причина не устанавливалась. Все контексты закрыты.
- Субагент визуально просмотрел `project-focus-1440.png` и `product-focus-390.png`: тёмные элементы читаемы, прямоугольные обложки не имеют полей. Оркестратор независимо просмотрел actual dark `product-focus-390.png`, receipt/digests и подтвердил визуальную приёмку.

Первый dark run `dark-run-1e648e65-3c52-4927-8706-cf9fa844e2a5` остаётся **HOLD**: ожидание DOM-подписи кнопки после reload, оба ACK восстановлены, стабильные карты одинаковы. Реальные ThemeProvider/ThemeToggle локально воспроизводят существующее рассогласование: persisted dark меняет HTML/React state, но DOM aria-label остаётся от светлого SSR. Последующий actual dark run сохранил такое исходное рассогласование для изделий при обоих viewport. Два штатных клика light→dark синхронизировали подпись; QA выполняет только ограниченные обычные клики и затем сохраняет прежние строгие проверки. Код CRM для этой отдельной accessibility-проблемы не менялся. Локальная диагностика: `.playwright-mcp/requests-171-179/staging176/local-theme-ssr-helper-results/receipt.json`.
