# Задача 115: фактическая приёмка staging и уточнение layout

Рабочая ветка: feature/115. Изменение: plain-file-lists.
Основные сценарии проверены на 37f882f69a2d76901b98321ff7824d0d04db4db8; последний income-сценарий принят на c1f5cd97041d171b80a03f5a1ace2dab387ed96c.
Собственный fixture: ff30f55e-dac2-48d2-ac5e-cad6400f3eca.
Историческая приёмка от 09.10.2026 завершена. Оба Parent fixture закрыты; её неизменяемые доказательства сохранены. Новое уточнение layout ниже пока не принято на staging.

## Реальные результаты

| Контекст | Проверка и результат |
| --- | --- |
| Проектный плоский список и разделы изделия, 1440 | 23 ранее пройденные проверки: название с расширением, отсутствие миниатюр/метаданных, изображения полностью, защищённое скачивание остальных файлов, клавиатура. Эти сценарии не повторялись. |
| Инженер на изделии, 1440 | 5 ранее пройденных проверок собственных/чужих файлов и состояния урны. Не повторялись. |
| Проектные и организационные расходы, 1440 | 3 контекста, 6 проверок: filename-only, disabled финансовая урна, настоящий PDF download. Не повторялись. |
| Организационный приход и кассовая выписка, 1440 | Имя и защищённые действия финансовых файлов; изображение полностью, PDF скачивается. |
| Обычная файловая строка, 390 и 360 | Без переполнения, название и кнопки, исходное изображение открывается полностью по Enter. |
| Финансовая строка, 390 | Название, disabled урна и геометрия без переполнения. |
| Действительный TaskDialog, 390 и 1440 | Название, отсутствие метаданных/миниатюры, исходное изображение; отмена сохраняет файл, pending блокирует Escape, одна manager-delete удаляет строку из кэша открытого диалога. |
| Подтверждённые удаления | Всего три реальные операции: task-image менеджером, собственный замер инженером, project PDF менеджером. У каждой настоящий native ACK. |
| Ошибка клиента | Производственный PDF сохранён; один локальный отказ без отправки upstream. |

Последний readonly-проход дал 11 новых проверок без pageerrors, denied reads и upstream writes. Подтверждения последних двух удалений дали 12 проверок, два запроса, два настоящих ACK и один локальный отказ. Финансовые значения, исходные записи и чужие версии S3 сохранились.

Fixture Task первоначально не отображалась: workId=null исключает её из рабочей области. Для проверки использован отдельный подписанный child: один Work с LEGACY, quantity=1 и priceSnapshot=total=0, без PriceItem. После одной настоящей операции Task.workId/updatedAt восстановлены точно, Work удалён, Parent получил штатный ACK. Это исправление тестового набора; приложение не изменялось.

## Финальная income-приёмка

В FinanceTab отсутствовала строка документа прихода. Исправление a0ec8344a6f1c863d9d3ee8a389fc40cb13a9b2b добавляет общий ReportDocumentButton. SSR adapter-target 4/4 и независимое review приняты ранее. Фактический healthy deployment c1f5cd97041d171b80a03f5a1ace2dab387ed96c подтверждён Root metadata acd843.

Финальный run 628ebdf7-97a1-4292-858e-eeac72301fba: четыре минимальные собственные загрузки, без повторения предыдущих матриц и native-проверок. На 1440 и 390 income-строка показывает название с расширением, без миниатюры/метаданных; урна неактивна, переполнения нет. UI writes=0, document content requests=0, credentials остаются только в памяти.

Первый проход остановился на wrapper flock REFRESH_OR_DEPLOY_BUSY до dockerexec. Сохранён тот же подписанный scope; после Root-проверки возобновлены только два недостающих документа, с прежним nonce. Sketch/PDF и graph повторно не создавались. Итог tool dd6597: FINAL_INCOME_PASS_AND_OWN_CLOSED, parentPartCount=24. Единственный offline cleanup budget: 65616 encoded bytes при cap 98304; выполнен обычный cleanup. Собственные File=1, FinanceDocument=3, Payment=2 и User=3 удалены. OWN_CLOSED подтверждает исходные таблицы/схему и финансовые факты по принятому контракту, preferences и S3; разрешённый монотонный ApiToken clock проверен, bot clock не менялся.

Parent cleanup завершена Root: tool b02c4a дал OWN_CLOSED. Все собственные File/FinanceDocument/Payment/User и остальные строки удалены, 19 собственных версий S3 убраны. 54 исходных таблицы, схема, финансовые факты, preferences и S3 совпали. Штатный restore input содержит две одинаковые полные observation: 129848 encoded bytes при cap 98304. Единственное офлайн измерение выявило превышение до dispatch. Root применил настоящий подписанный cleanup-intent через компактный carrier с одной observation и восстановлением alias перед неизменным original cleanup. Caps, HMAC и CAS не ослаблялись.

## Неизменяемые доказательства

Все перечисленные файлы находятся в:
C:/Users/admin/.codex/worktrees/crm-task-113/pero_crm_v2/apps/web/test-results/files-final-ff30f55e-dac2-48d2-ac5e-cad6400f3eca

| Файл | SHA256 |
| --- | --- |
| consumer-v12-remaining-small-matrix-lists-lists-result.json | f26f874b9fe817921e3935428b961e2b704b4b328c0ef97460031a9773562085 |
| consumer-v13-task-work-lists-result.json | 15764903ed18bdbb5cc4e6251994e4d7fd2815e9eaff20f4265bc6c3dcc0e810 |
| consumer-v14-delete-only-lists-lists-result.json | af3cdafcae8479801bd5a45360822ebc1cc6522bb13e0f00b0046991d823361a |
| consumer-v15-cleanup-preflight-lists-result.json | d4668c6ce93be80f810fd9595fbb1642c1918c35a6e9025423e897f46c1d3740 |
| 0118-cleanup-intent.json | b2002a2e410b353f83a72a8e78ffbbde8ab092d931cca22fd599fef188b8fefa |

На момент cleanup-intent: Work=0, File=4, FinanceDocument=3, собственных версий S3=19; originalsMatch=true. Root carrier удалил эти собственные записи; поздний OWN_CLOSED подтверждён tool b02c4a. Последний income-gate закрыт на c1f5cd97041d171b80a03f5a1ace2dab387ed96c.

## Доказательства последнего run

Каталог: C:/Users/admin/.codex/worktrees/crm-task-113/pero_crm_v2/apps/web/test-results/final-income115-628ebdf7-97a1-4292-858e-eeac72301fba

| Файл | SHA256 |
| --- | --- |
| income-readonly-003-result.json | 24ba4df270bc6d73e0537c3ccc0cecbd1d11c6fec3a971c1f1dc81c09d5b7f86 |
| 0020-final.json | dc2bd69ad6fe63640bdd6ee1b256aa250d6c803a4a05ab67168df6d0ce505794 |
| 0023-cleanup-ack.json | a1e32d9040f3c0366bacaf1fdeb1aa68072b35965a6a3a58b1dae3ada4209a23 |
| 0024-closed.json | bfde943f338450c23668cceba4059e4b9da95376551cacc7168b0378d8c22dc7 |
| final115-resume1-result.json | 30f2f3918f9cdbcbdac751e50c4348988f057ef01ab68a254b033f1d03d4ddfa |

## Уточнение layout от 09.10.2026 — pending

После новой обратной связи владельца требуется общая рамка для header и всех файлов группы: название с количеством слева, upload справа, строки одной колонкой внутри. Нужна только короткая geometry-проверка 1440/390/360 и приёмка новой развёрнутой ревизии. Исторические image/download/print/delete/permissions/native сценарии не повторяются, поскольку их код не меняется.
