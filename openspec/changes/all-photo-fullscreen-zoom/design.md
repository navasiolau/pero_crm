# Design

## Context

FileViewer используется useFileViewer в файлах проекта/изделия, TaskDialog и ProductCoverLayout. Только cover-fullscreen сейчас полноэкранный; standard image ограничен max-w-4xl. Base UI Dialog уже управляет фокусом, Escape и блокировкой фона; общий DialogContent учитывает visualViewport.

## Goals / Non-Goals

**Goals:** универсальный image dispatch и локальные жесты полноэкранного изображения, сохраняющие выбранную точку и границы.
**Non-Goals:** новые библиотеки, изменение API/ACL/PDF, финансов, подписи, глобальные body/viewport CSS-переопределения.

## Decisions

- Сохранить useFileViewer и варианты. getFileViewerPresentation получает MIME-контекст; любой image/* использует полноэкранный popup, а cover-fullscreen сохраняет свой marker.
- Новый FullscreenImageViewport использует pointer capture и локальные passive:false wheel listeners; touch-action:none только на поверхности изображения. Base UI Dialog остаётся единственным владельцем body lock/focus/Escape.
- Чистая математика fit, zoom-at-anchor и ограничение pan проверяется независимо от UI. Масштаб 1–8, координаты относительно центра поверхности; clamp зависит от реально вписанного изображения.
- Компонент keyed по file id; закрытый viewer размонтирует поверхность. При resize координаты clamp, при загрузке нового файла состояние начинается с fit.

## Risks / Trade-offs

- [Жесты выходят за поверхность] → pointer capture, очистка pointer map на cancel/lost capture и масштабные лимиты.
- [Колесо прокручивает страницу] → локальный non-passive listener и modal Dialog без глобальных CSS-hacks.
- [Короткое окно/zoom браузера] → существующий visualViewport DialogContent и ResizeObserver поверхности.

## Migration Plan

Без миграций. Focused RED→GREEN, type/lint; совмещённая визуальная проверка после интеграции №33–38 выполняется root. Git/deployment/БД вне работы субагента.
