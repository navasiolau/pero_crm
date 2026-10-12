# Tasks

## 1. Context

- [x] 1.1 Fresh fetch, bugfix/146 от 465a59d; виджеты/Portal/план прочитаны, реализация согласована, OpenSpec pure execution.
- [x] 1.2 Зафиксированы реальные native before/after серии 100/1000/5000 и точное определение метрики с пределом сохранённых данных.

## 2. Implementation

- [x] 2.1 Lazy popup child, общий normalized cache, memo rows/callbacks/caption/set; сохранены clear/disabled/hint/unknown IDs/keyboard/classes.
- [x] 2.2 После измеренного нарушения бюджета добавлено окно только для large MultiSelectFilter; Single остаётся без виртуализации.

## 3. Local verification

- [x] 3.1 Зафиксированы native timings/longtasks, closed walks, функциональные проверки, три viewport appearance, TSC/lint/strict; итоговый Multi/5000 p95 25,2 мс, длинных задач 0.
- [x] 3.2 Независимое финальное code/evidence review принято; чужие task/payment UUID paths сохранены.

## 4. Staging

- [ ] 4.1 Атомарный commit, normal integration Root, CI и actual image приняты.
- [ ] 4.2 Реальный large picker в приложении принят на desktop/mobile; main/production запрещены.
