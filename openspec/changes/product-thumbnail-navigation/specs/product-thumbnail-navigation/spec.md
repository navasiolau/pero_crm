## Purpose
Единый переход из глобальной карточки изделия по миниатюре и тексту с сохранением исходного списка и защитой от открытия при перетаскивании.
## ADDED Requirements
### Requirement: Global thumbnail opens product
Global Product thumbnail SHALL открывать ту же карточку и безопасный returnTo, что row/title, без fullscreen и двойной навигации.
#### Scenario: Thumbnail click
- **WHEN** пользователь нажимает thumbnail вне drag
- **THEN** происходит один переход Product с canonical global list context.
### Requirement: Drag and other viewers
Перетаскивание MUST не открывать Product/fullscreen; существующие detail/file fullscreen остаются прежними.
#### Scenario: Dragging cover
- **WHEN** thumbnail получает click при активном dragging
- **THEN** navigate/fullscreen не выполняются.
