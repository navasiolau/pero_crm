# Design: settled-sums

## Решение

1. `queries.ts`: `draftTotal` при `!completion || editableAfterSkip`; `members` fallback на назначенного при пустых долях (своя строка и прогноз работают для пропущенного).
2. `product-percentage-panel.tsx`: `showSum = displaySum !== null || rateMissing`, `rateMissing` расширен на `SKIPPED_ONCE` (подсказка менеджеру).
3. Фильтры: `hideEngineer`/`hideEngineerFilter` пропсы в `ProductsFilterBar`/`ProjectsFilterBar` + views; серверные `page.tsx` вычисляют `role.includes("ENGINEER") && !hasAnyRole(role, MANAGER_ROLES)`.
4. Тесты: пропущенный/закрытый этапы для назначенного/чужого; рендер обоих фильтров с флагом и без.

## Риски

- Показ прогноза для пропущенного начисления не создаёт начисление — только отображение; путь добора денег за пропуск отсутствует и зафиксирован как известное ограничение.
