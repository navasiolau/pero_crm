# Design

## Context

Исходный JSX обходил options до того, как Portal решал, монтировать ли содержимое. Подпись выбранного значения должна зависеть от полного справочника, а MultiSelectFilter должен сохранять неизвестные IDs и существующее правило «выбраны все известные».

## Decisions

Parent сохраняет open/query/searchInputRef, trigger и onOpenChange. Приватный OptionsContent находится внутри прежнего Portal/Popup. Lazy mounting убирает работу закрытого списка, сохраняя closing animation и различие между прямым selection/clear и onOpenChange(false).

useOptionsFilter возвращает оригинальные ссылки на options; normalization кешируется по options, locale и searchHint. Single использует toLowerCase и hint, Multi — toLocaleLowerCase('ru') и только label. Memo-строки сохраняют button/Checkbox/Label/classes. Подпись и выбранный Set не пересчитываются из-за каждого символа query; callbacks получают актуальные value/options.

Фактический замер после кеша/memo подтвердил нарушение long-task бюджета только у Multi/5000. Поэтому окно используется лишь для MultiSelectFilter при options.length >1000; отфильтрованный результат не переключает большой справочник обратно на тысячи DOM checkbox. Окно содержит видимые строки с overscan и максимум одну удерживаемую строку последнего keyboard focus. DOM индексы сортируются численно, чтобы естественный Tab сохранял логический порядок. Переход фокуса к search/reset не удаляет эту строку в blur; иначе Base UI restoreFocus возвращал бы фокус контейнеру popup. Pin заменяется при следующем checkbox focus или исчезает при query/unmount. Tab/ShiftTab переводят фокус на соседний логический option и прокручивают его в viewport; Space сохраняет native checkbox action. На границе списка Tab выходит обычным способом. Scroll/ResizeObserver удаляются при unmount. Высота берётся из untransformed computed layout, чтобы zoom-анимация Popover не сжимала шаг мобильных строк.

## Verification

Существующий React/Chromium harness использует реальные виджеты, Base UI, native keyboard и монотонный browser clock. Один before/after запуск на 100/1000/5000 options дал 1200 клавиш; после подтверждённой необходимости окна выполнены только целевые Multi/5000 серии по 100 клавиш. Бюджет, trusted sequence и полнота второго RAF проверены runtime assertions. JSON сохраняет count/p95/max/longtasks/source hashes, но не сырые timestamps каждой клавиши; независимый пересчёт p95 по JSON невозможен. Этот предел явно сохраняется в evidence.

Для внешнего вида на 1440×900, 390×844 и 360×800 сравниваются фактические controls/style/geometry и RGBA области popup content. Full PNG на desktop имеет отдельно принятую разницу 19 boundary pixels с максимумом 1 channel unit на trigger; whole-image equality не заявляется. На двух мобильных размерах whole RGBA совпадает. Данные, CSS и ожидания не меняются ради изображения; это компонентная fixture, не полноэкранный staging UI.

## Non-Goals

Financial server, task/payment UUID dialogs, schema/API/roles/CSS/dependencies, общий QA framework и новые profiler registries. Physical iMac исключён владельцем; доступный ПК используется для измерений. Компонентные результаты не подменяют staging.

## Migration Plan

Миграций нет. Local → независимое ревью → атомарный commit → Root normal merge/CI/actual staging. SAFETY-RULES: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md, STOP при guard mismatch. Restic, дампы, reset/seed/newDB и main/production запрещены.
