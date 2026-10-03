# Design
## Context
ProjectProducts уже передаёт navigate policy; global consumer нет. Shared card останавливает propagation, вызывает openProductCardCover и проверяет dragging. Route51 уже строит Product URL с canonical returnTo.
## Goals / Non-Goals
Thumbnail и row/title открывают один Product route без двойного push. Не менять карточку/hero стили, fullscreen файлов/detail, деньги/даты.
## Decisions
Только global DraggableProduct добавляет coverAction.navigate и передаёт actual isDragging в существующий общий guard. Handler использует тот же onOpen(product), который хранит контекст51.
Проверить actual sharedcard DOM callback из SSR через capture createElement props, Dnd lifecycle controlled stub и обычный router mock; не regex source как основное доказательство.
## Risks / Trade-offs
Клик кнопки не должен bubble в row и повторить navigate. Drag guard сохраняется; acceptance actual pointerdrag остаётся Root.
## Migration Plan
Без миграций; отдельный52 после51, ordinary Root integration/staging.
