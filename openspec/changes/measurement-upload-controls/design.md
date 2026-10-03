# Design
## Context
Measurement generic Uploader уже fixedMEASUREMENT; PhotoUploadButton добавляет вторую кнопку. Shared barrier включает upload/photo/deletion, photo используется только здесь.
## Goals / Non-Goals
Одна строка header+file upload. Не менять transport47, error48, callback busy/unknownACK, delete viewer/ACL и photo в Task/sketch.
## Decisions
Uploader optional header ReactNode формирует flex minw0 title/button; безheader обычное представление unchanged. Product Measurement передаёт header толькодляcanEdit; readonly показывает heading безcontrol. Удалить только measurement PhotoUploadButton и неиспользуемый barrier.photo; upload/deletion guard сохраняется. Input/file handler FormData unchanged.
## Risks / Trade-offs
Минимальная ширина title0, uploadbuttonshrink0 и gap обеспечивают обычную строку360; pixel QA Root отдельно. No optimisticfake successfulrows; existingdiagnostics+retry unchanged.
## Migration Plan
Без миграций, own49 ordinarymerge, actual Root staging upload.
