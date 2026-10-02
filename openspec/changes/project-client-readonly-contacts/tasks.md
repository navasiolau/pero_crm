# Tasks
## 1. Контракт
- [x] 1.1 FF/apply и strict validate до реализации.
- [x] 1.2 RED→GREEN actual SSR readonly контактов, без редакторов address/phone.
## 2. Реализация
- [x] 2.1 Contacts selector и ClientDialog, Client DTO и confirmed ACK address; тесты контактов и CAS.
- [x] 2.2 Исключить делегированные controllers карточки, сохранить исторические данные и остальные partial fields; typecheck.
## 3. Приёмка
- [x] 3.1 Targeted tests/lint/tsc, точный handoff root.
- [x] 3.2 Root actual staging после ordinary merge; визуальная QA отдельно.

Локальные доказательства: actual SSR RED2/2 → GREEN2/2, затем 34 targeted tests PASS (включая реальный core CAS/Client.address ACK и неизменность historical Project.address/delivery). Typecheck и scoped lint PASS. Браузер/staging не запускались агентом.
