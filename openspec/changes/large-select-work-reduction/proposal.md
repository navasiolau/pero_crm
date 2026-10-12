# Proposal

## Why

Закрытые SearchableSelect и MultiSelectFilter создавали строки списка даже при вводе в соседнем поле. При поиске MultiSelectFilter повторно нормализовал подписи и создавал тысячи checkbox. На фиксированном справочнике из 5000 записей доступный ПК показал p95 200 мс от native keydown до второго кадра и 40 длинных задач в сериях ввода.

## What Changes

- Содержимое popup выделено в приватный компонент внутри прежнего lazy Portal; закрытый список не фильтрует и не отображает options, а анимация закрытия и сброс query сохранены.
- Один небольшой типизированный hook кеширует нормализованные подписи по options/locale. SearchableSelect ищет label и hint, MultiSelectFilter — только label с прежней русской локалью.
- Строки memoized, callback и подпись выбранного значения стабильны. Сохраняются clear, disabled, неизвестные IDs, клавиатура и классы controls.
- Для MultiSelectFilter со справочником более 1000 options добавлено окно видимых строк. Это потребовалось после фактических 5 длинных задач 150–168 мс при 5000 options даже после кеша/memo. SearchableSelect в бюджет уложился без виртуализации.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет изменения требований. skip_specs: true применяется к оптимизации исполнения; выбор и фильтрация сохраняют прежнюю семантику.

## Impact

Ветка bugfix/146 от свежего origin/staging 465a59d0709edabf4396a966bb53cd76868f7b86. Три production paths: два виджета и use-options-filter.ts. Проверки расширяют один существующий project-filter-component.test.mjs; новые зависимости, CSS, API, схема и task/payment UUID-пути не меняются.

Бюджет доступного ПК: p95 native keydown → второй requestAnimationFrame ≤100 мс и отсутствие относящихся к серии длинных задач >50 мс. После последней правки MultiSelectFilter/5000: p95 25,2 мс, максимум 31,7 мс, длинных задач 0 на 100 доверенных клавишах. Это компонентный замер, не INP и не доказательство исправления конкретного iMac. Независимое ревью и реальная staging-приёмка остаются обязательными; main/production запрещены.
