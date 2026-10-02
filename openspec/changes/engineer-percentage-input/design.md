# Design

## Context

SinglePercentageRow использует InlineTextField w-24 и createSinglePercentageControllers с преобразованием запятой. Текущий controller сохраняет CAS/revision/UUID и очередь lost ACK.

## Decisions

Новый text input фильтрует ASCII цифры и точку, максимум две дробные цифры. Стрелки используют целые сотые, шаг 10 сотых, ограничение 0–10000. Пустой ввод остаётся NULL; стрелка вверх от пустого задаёт 0.1, вниз задаёт 0. Текущий draft, включая несохранённый, является базой шага. Сохранение идёт тем же controller. Только ENGINEERING расширяется до 192px; max-width и min-width сохраняют ряд на мобильном. Исторический блок убирается, retry PENDING_FX сохраняется.

## Risks

Параллельный ACK не должен заменять новый draft; проверяется существующей очередью и тестом. Open Questions отсутствуют, запрос владельца согласован.
