# Proposal
## Why
Замер содержит дублирующие photo/file controls и отдельный заголовок. Владелец требует одну строку Замер + Загрузить файл.
## What Changes
- Measurement heading и существующий file trigger в одной адаптивной строке.
- Только measurement photo duplicate удалён; task/sketch photo и остальные upload controls прежние.
- Fixed MEASUREMENT/project/product/stage transport и error47/48 не меняются.
## Capabilities
### New Capabilities
- `measurement-upload-controls`: один upload control в header Замер.
### Modified Capabilities
Нет.
## Impact
ProductAttachments и optional presentationprop Uploader; только UI, без storage/API/dependency/schema changes.
