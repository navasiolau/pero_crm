## Purpose
Компактное отображение изображений во всех списках файлов с качественным детальным превью и сохранением защищённого полноразмерного оригинала.
## ADDED Requirements
### Requirement: Bounded authenticated previews
Система SHALL отдавать bounded thumbnail, card и cover после проверки доступа; original bytes MUST сохраняться неизменными.
#### Scenario: Unauthorized warm cache request
- **WHEN** права на файл отсутствуют после прогрева cache
- **THEN** ни preview, ни его ETag не доступны, original storage не читается.
### Requirement: File row image
Изображение SHALL отображаться маленькой миниатюрой справа от filename/category; клик SHALL открыть оригинал существующим fullscreen viewer.
#### Scenario: List rendering
- **WHEN** список Product/Project/Task содержит изображение без legacy thumb
- **THEN** ряд показывает bounded preview справа, original не загружается до просмотра.
### Requirement: Detail quality
Детальный cover SHALL использовать более крупное preview чем card и высокое качество, сохраняя оригинал для fullscreen.
#### Scenario: Preview failure
- **WHEN** preview не может быть создано
- **THEN** UI показывает ошибку без fallback full original.
