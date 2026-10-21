# Tasks

## 1. Контракты и обработка

- [x] 1.1 Реализовать media tokens, владение вариантами и подготовку JPEG/PNG/WebP; проверить реальные кодеки, лимиты, magic bytes и неизменность подготовленных байтов.
- [x] 1.2 Реализовать S3 immutable put/readback с binding guard; проверить неизвестный ACK, конфликт checksum и смену цели через DI без облачных вызовов.

## 2. Двухфазные операции

- [x] 2.1 Реализовать устойчивое резервирование, завершение, чтение и повтор загрузки на ProposalJob/Media; проверить частичный сбой, отозванные права, ревизию и блокировку.
- [x] 2.2 Реализовать независимые копии и hook сохранения/retirement управляемых File; native PostgreSQL с MemoryS3 подтвердил атомарные ссылки, независимые ключи копий, сохранность ручных файлов/обложек и точность cleanup intents.
- [x] 2.3 Добавить аддитивную миграцию и модельные поля; после обычного merge №180 проверить prisma validate/generate и типизацию. После отдельного разрешения владельца оркестратор применил local №181–183 штатным Prisma deploy: старые данные/receipt сохранены, enum committed, 11 таблиц КП пусты; native media-проверка отдельно в 3.2.

## 3. Приёмка

- [x] 3.1 Выполнить targeted tests, lint и OpenSpec strict; зафиксировать результаты и границы в evidence.
- [x] 3.2 Завершить guarded приёмку настоящего S3: private immutable Put/Get/readback, versioning и согласованная физическая очистка. Native DB local/staging 7/7 с MemoryS3 и полным rollback76/catalog приняты ранее; настоящее S3 принято составной цепочкой FULL55 10/10 (исходные6 + retry/due2 + annual2), с сохранением PDF/DOCX/Product copies и original quarantine RESTORED. Доказательства, допустимые own изменения и отдельные RAW telemetry — в evidence.md; разрешение на business cleanup из этой проверки не следует.
- [x] 3.3 Завершить приватный пользовательский сценарий после подключения транспорта №187. Root принял CORE4/media/API и desktop/mobile UI на staging acbd/8ef120: Lead23, Locked UI34 и Manager composition5+1; доказательства и границы в verification.md. Physical versioned cleanup принят отдельно составной приёмкой FULL55 в пункте3.2; последующий настоящий retained SDK save/generate/download также принят. Ordinary LEAD/restore410 остаётся отдельным незавершённым сценарием №188/185, не основанием повторять принятые media/SDK проверки.
