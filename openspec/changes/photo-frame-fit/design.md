# Design

## Context

ProductCoverLayout сохраняет aspect4/5 либо desktop viewport-height; ProjectCover —4/3. ProductHeroImage внутри растянутого button рисует object-contain, внешняя border/bg создают полосы.

## Goals / Non-Goals

**Goals:** только видимая рамка/фон под размер изображения.
**Non-Goals:** размеры зарезервированного layoutslot, положение/масштаб img, кнопки/права/файлы/fullscreen/канбан-фото.

## Decisions

Общий ContainImageFrame сохраняет hostclass/dimensions, прозрачную1px границу и прозрачный фон при filled. Внутри pointer-events-none border накладывается на actualpainted rect изображения, вычисленный по naturalWidth/Height и bounds текущего img. Img/положение/transform не менять; capture load/error и ResizeObserver обновляют рамку, cachedcomplete учитывается. Empty/failure сохраняют прежнюю рамку и фон. Кнопки/области клика прежние. Component keyed source сбрасывает отложенную рамку при замене.

## Risks / Trade-offs

Сохранение положения оставляет прозрачное свободное пространство layoutslot → это намеренное следствие ограничения владельца; тёмных полей рамки нет. Broken/cached image/resize → отдельные проверки и вычисление только при успешной загрузке. Roundoff pixels → browserassert tolerance1px.

