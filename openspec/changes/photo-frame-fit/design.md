# Design

## Context

ProductCoverLayout сохраняет aspect4/5 либо desktop viewport-height; ProjectCover —4/3. ProductHeroImage внутри растянутого button рисует object-contain, внешняя border/bg создают полосы.

## Goals / Non-Goals

**Goals:** отсутствие видимой рамки и фона вокруг фото с первого paint, без перехода при загрузке.
**Non-Goals:** размеры зарезервированного layoutslot, положение/масштаб img, кнопки/права/файлы/fullscreen/канбан-фото.

## Decisions

Обычный div сохраняет hostclass/dimensions и прозрачную1px границу для прежней геометрии, но всегда получает border-transparent/bg-transparent, в том числе до image load. Видимой рамки, overlay, вычислений naturalWidth/Height, load/error handlers рамки и ResizeObserver нет. Img/положение/transform не менять. Empty/failure сообщения, кнопки/области клика и upload/ACK логика прежние; внешний декоративный border/bg отсутствует и в этих состояниях.

## Risks / Trade-offs

Сохранение положения оставляет прозрачное свободное пространство layoutslot. Проверить loading/cached/broken/resize и первый paint: оформление контейнера не должно зависеть от момента загрузки фотографии. Геометрия изображения должна совпадать с исходной.
