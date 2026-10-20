# Tasks

## 1. Авторизация и HTTP
- [x] 1.1 Добавить canonical scopes, свежий owner/session authorizer и повторные проверки с блокировками; проверить матрицу ключей/ролей/отзыва/Origin DI-тестами.
- [x] 1.2 Добавить общий router и два тонких handler с закрытыми схемами и bounded body; проверить HTTP методы, off flag, отсутствие cookie fallback и лимиты потока. Для неожиданных ошибок добавлен обезличенный server report; проверены отсутствие SQL/секретов и неизменность 503 при отказе диагностики.

## 2. Общий сервис
- [x] 2.1 Собрать №181 + №182 с фиксированным курсом, ожидаемым номером и API receipt/audit в одной транзакции; проверить rollback, replay до I/O и lookup operations. Реальные зависимости интегрированы, local DI/typecheck выполнены; actual API SQL/runtime отдельно в 3.3.
- [x] 2.2 Подключить №183 upload/prepared copies/private media и hooks; проверить owner/revision guards и отсутствие storage keys в DTO. Local DI/typecheck выполнены; настоящее хранилище отдельно в 3.3.
- [x] 2.3 Подключить №185 версии/restore/PDF worker и private artifacts с историческим курсом; проверить сохранённые снимки, приватные результаты и повторную авторизацию. Closed render adapters типизированы с реальными producers; actual worker/HTTP отдельно в 3.3.
- [x] 2.4 Подключить №186 forms/settings/contract jobs и единый finalize; проверить отсутствие raw-state bypass и частичных переходов. Реальные lifecycle/contract ports скомпонованы без заглушек; actual API/render отдельно в 3.3.

## 3. Интеграция и приёмка
- [x] 3.1 Добавить пресет ключа КП, OpenAPI и docs/API.md; сверить документацию с фактическими schema/route тестами.
- [x] 3.2 Завершить local-приёмку после обычных merge: Prisma validate/generate, full typecheck, lint, 37 unit/HTTP-DI, OpenSpec strict и guarded inert Next build выполнены.
- [ ] 3.3 Завершить сквозную guarded staging-приёмку закреплённого SHA/образов. На acbd164c / CI306 (7/7) приняты API CORE4 money/media/versions/contracts, AI01 SDK/MCP/Python, 25 private-file отказов и 2 чтения НБРБ; AUTH — 22 роли, 71 scopes, 10 boundaries, 72 operation cases и четыре credential transitions. Приняты KP_EDITOR_ONLY Lead UI (FULL23), Locked8 (UI34) и MANAGER_BROWSER составным evidence 5+1. Эти API/auth/UI-компоненты завершены в зафиксированных scope; их не требуется повторять из-за исторических HOLD. Открыта оставшаяся согласованная сквозная приёмка: physical №188 и полный cutover №189. Полная приёмка №187, switch и production ещё не объявляются выполненными; точные receipts, ограничения и сохранённые неуспешные попытки — в verification.md.
  - 20.10, актуальное дополнение: Root принял составной MANAGER_BROWSER 5+1, UI34 Locked8/Mixed2 и AUTH35 manager-deactivation (12 ключей/11 новых отзывов, active=false/SV1, два GET401). AUTH35 producer/host ACK принят с отдельным поздним readonly after-control; original outer HOLD_MISSING_BOUNDARY/busy REFUSED сохранены. AUTH31/72 и прежние успешные компоненты остаются принятыми; исторические неуспешные статусы в хронологии verification.md не переписаны. Точные classification refs — там же. 3.3 остаётся [ ] для оставшейся сквозной приёмки, включая physical №188 и полный cutover №189; production/switch не объявляются выполненными.
