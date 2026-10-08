# Приёмка №105 — отчёт по кассам

08.10.2026, feature/105 от свежего staging b637c40dcc1e13409ac544f88c84eb076782b406.

## Local

- RED→GREEN6 сценариев: включительные MSK-границы, opening/income/expense/closing, зарплата/аванс, native/BYN, unknown/unassigned/mismatch, большие точные копейки и отказ роли до чтения БД. Fullweb1344/1344, types/lint/build/strict PASS; 5 прежних lint warnings.
- Общий cashMovementDelta используется отчётом, текущими кассами и денежным readCashBalance. Decimal до границы DTO; точные строки и BigInt-форматирование. BYN — сохранённые эквиваленты и действующий historicalByn; live FX не вызывается. PayrollEntry/складские списания не считаются кассовыми выплатами.
- Настоящий PostgreSQL: BYN opening100 + income50 − expense10 − salary20 − advance5 = closing115. USD native85 и сохранённый BYN252; неактивная касса видна. Полный период совпадает с readCashBalance, начисление999999 не влияет на кассу. Старые выплаты без валюты/кассы остаются явно неизвестными/нераспределёнными. Роль manager отклонена, M+ACCOUNTANT разрешена.
- Native полностью rollback, исходные User/Payment/Payout/CashAccount/PayrollEntry/FinanceDocument/StockMovement/StockPurchase/ChangeLog/DomainEvent digest MATCH. Первоначально неполная тестовая выплата отклонена DB CHECK; фикстура исправлена на допустимые полные новые и полностью legacy записи, ограничение БД сохранено.
- Реальный localhost3098: страницы BYN/NATIVE, диапазон, сохранённые суммы, supplier/manager-denied/combined PASS. Reader использует одну RepeatableRead read-only транзакцию. Собственные исторические HTTP-фикстуры удалены точно, исходные digest MATCH, providerMessages0.
- Настоящие React/DataTable/Dialog/FileViewer с собранными CSS: desktop1440/mobile390, открытие кассы, документ, URL дат/режима и отсутствие горизонтального overflow PASS. Только Next Link заменён anchor в изолированном компонентном harness; настоящие SSR-маршруты проверены отдельно. Ошибок браузера нет. Собственный сервер остановлен.
- Миграций нет. Дампы/Restic/seed/reset не выполнялись. Staging bundle подготовлен с native/HTTP и существующими W07/identity/timeout guards.

## Staging

- Обычный merge `a63c08fd753120dd9ab4eef71872ecce022cc57f`, CI171 SUCCESS: https://github.com/navasiolau/pero_crm/actions/runs/37747933122. Фактическая revision совпала; образ `sha256:1d7fa1840835c30061fc7690dd41bdadd400bb08dffcd6c56613539c775a5897` healthy.
- Native на развёрнутом окружении: closing115BYN,85USD/252 сохранённых BYN, зарплата/аванс ONCE, денежное ядро MATCH, unknown/unassigned явно обозначены. Реальные страницы BYN/NATIVE/некорректного диапазона и supplier/manager-denied/combined PASS. Исходные digest MATCH, QA0, providerMessages0.
- Bundle `a5ff6c150e8d718da18a9b0148887a02c7ad71783c9f4cc267b16dc0614e1ce0` (50826bytes). DB container/volume/start и W07 SHA сохранены. Миграций и дампов нет, Restic не затронут. Main/production не менялись.
