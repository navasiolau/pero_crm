# Tasks

## 1. Общая серверная операция
- [x] 1.1 Добавить RED сценарии подтверждённого документа и повторного платежа; проверить однократность и отказ чужого документа.
- [x] 1.2 Выделить payment contract/receipt и добавить атомарную привязку FinanceDocument; пройти domain/native проверки без изменения прежних входов.
- [x] 1.3 Добавить bot upload adapter над общим HTTP сервисом; проверить Bearer scope/actor/roles до multipart.

## 2. Telegram
- [x] 2.1 Добавить ограниченный download document/photo и multipart CRM transport; проверить origin/path/размер/секреты и сбои.
- [x] 2.2 Добавить шаг документа, подтверждение и устойчивые UUID; проверить сценарии фото/PDF, отказ MANAGER, потерянный ACK и точный retry на изолированном Telegram transport.

## 3. Приёмка
- [x] 3.1 Пройти необходимые web/bot tests, typecheck, lint/build, strict и локальный native сценарий; записать evidence.
- [x] 3.2 После обычного merge пройти CI и фактическую staging-приёмку API/образов без сообщений сотрудникам; записать evidence.
