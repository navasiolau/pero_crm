# Tasks

## 1. Регрессии

- [x] 1.1 Добавить тест реальных server pages с матрицей ролей, постоянными IDs, последней вкладкой/секцией; зафиксировать RED до подключения журнала.
- [x] 1.2 Добавить browser-проверку настоящего отложенного монтирования: ноль запросов до вкладки/intersection и точный scope после открытия.

## 2. Подключение

- [x] 2.1 Подключить ADMIN-only финальную вкладку проекта и разрешить tab=journal только ADMIN; проверить server render и browser.
- [x] 2.2 Подключить ADMIN-only нижнюю секцию изделия и EntityJournal whenVisible без изменения существующих разделов; проверить server render, browser и product-single-page regression.

## 3. Приёмка

- [x] 3.1 После штатного merge №223 выполнить целевые tests, lint, tsc и strict OpenSpec; записать evidence.
- [ ] 3.2 Передать root diff для ревью и подтвердить реальный staging после штатного CI: ADMIN и DIRECTOR, last-tab/bottom-section, lazy чтение, контекст и доступность.
