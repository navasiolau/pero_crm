## Purpose
Один понятный файловый control в заголовке Замер без дублирующей фото-кнопки и без изменения прав или протокола реальной загрузки.
## ADDED Requirements
### Requirement: One measurement upload header
Секция Замер SHALL показывать заголовок и кнопку Загрузить файл в одной строке; дублирующий photo control MUST отсутствовать только в этой секции.
#### Scenario: Editable measurement
- **WHEN** разрешённый пользователь открывает Замер
- **THEN** есть один file trigger рядом с заголовком; task/sketch photo сохраняются.
#### Scenario: Readonly measurement
- **WHEN** пользователь не может загрузить файл
- **THEN** заголовок и существующие файлы видны без upload controls.
### Requirement: Transport preserved
Загрузка MUST сохранять fixed MEASUREMENT, actual project/product/stage, clientMutationId/ACK и busy/error/unknown guards.
#### Scenario: File selected
- **WHEN** пользователь выбирает file через единственный trigger
- **THEN** отправляется существующий upload protocol с MEASUREMENT и реальным контекстом.
