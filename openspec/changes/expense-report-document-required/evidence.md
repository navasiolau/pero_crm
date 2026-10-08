# Приёмка №99 — обязательный отчётный документ

Дата08.10.2026, feature/99 от c73f4f5651f885200e19b3ef68aaa3e70534e8af. Используется завершённый managed worktree97; feature97 сохранена, исходный D:/Projects/pero_crm_v2 не изменялся. Владелец разрешил staging; main ожидает его проверки.

## Local

- RED подтверждён на прежнем core/transaction; после policy оба отклоняют новый EXPENSE без файла до DB/FX. Клиентский флаг warehouse/skipReportDocument не даёт исключения.
- Полный web1323/1323 PASS, build/TypeScript PASS, lint0ошибок (прежние5 предупреждений), strict PASS. Ошибка shadowing DOM document в новом QA-скрипте исправлена до успешной сборки.
- Настоящий PostgreSQL: расход100BYN+документ один раз, foreign/PENDING/occupied/missing document, modified replay, replay deleted and historical undocumented operation. Ошибка receipt откатила всю транзакцию; originalData MATCH.
- Реальный localhost web: обязательный uploader блокирует кнопку, после ACK она доступна; оригинал открывается из строки расхода. Показ проверен на1440×900 и390×844, внутренний scroll делает footer доступным; скриншоты формы/мобильного footer просмотрены.
- Для UI созданы только собственные user/cash/article/document и нулевой read-only expense fixture; реальные финансовые actions/рассылки не запускались. Точные строки/bytes удалены, исходные счётчики MATCH. Исходные проекты использовались только для чтения.
- Настоящий bot API отклонил EXPENSE без файла, включая поддельный флаг исключения; token/scope/role/upload/replay проходят. Свои временные данные удалены, originalData MATCH.
- Компонентные тесты: доход без статьи/документа, расход с обязательными статьёй и файлом, стабильный UUID после ошибки и игнорирование позднего upload ACK новой формой.
- Общий paymentView сохраняет null и возвращает только разрешённые поля файла; FINANCE guards сохранены. Реэкспорт PaymentDialog/type остаётся совместимым, сервер больше не импортирует React DTO.

## Staging

Ожидаются CI, фактическая ревизия и runtime-проверка. Новых SQL-миграций нет, история денег не меняется.
