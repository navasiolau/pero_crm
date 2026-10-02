# Design

## Context

Цена и количество сейчас разделены карточками, header действия во второй строке. Эскиз sticky в product-sketch-view принадлежит №43. Рабочая ветка bugfix/41 от staging02d7db1, изолирована.

## Decisions

Header flex wrap с actions ml-auto. Price/quantity/sum одна min-width0 grid-группа; единичная цена сохраняет текущий controller. Qty text input принимает целые ASCII цифры, шаг вычисляется целыми и ограничен 1..2147483647; пустой draft временно разрешён, сохранение требует min1, стрелка пустого задаёт1. Readonly сумму считать productLineTotal из валидных draft; NULL не ноль, недопустимый draft не показывает вымышленную сумму. Сохраняются CAS/UUID/dirty и lost ACK. Все ставки получают прежний 192px input; только сборка/монтаж скрывают пояснения, оставляя предварительную сумму. Frozen/payroll/domain код не затрагивается. №43 удаляет только sticky/top20 без других сдвигов эскиза.

## Risks

Узкий экран: min-width0, гибкие колонки и break-words. Серверная масштабировка quantity unchanged. Open Questions отсутствуют, прямой запрос согласован.
