# UI evidence, 29.09.2026

Scope: только новая вкладка `Состав`, её presentational view/form helper и интеграция в Product detail page. Native БД, Next runtime, браузер, скриншоты, staging, commit и push не выполнялись.

- Meaningful RED: при существующих CONFIRMED + DRAFT запрос без выбранной ревизии возвращал DRAFT (`actual: draft`, `expected: confirmed`). После перестановки приоритета в `getProductCompositionFor` тест GREEN. Черновик открывается через явный селектор/«Продолжить черновик»; если подтверждённой ревизии нет, он обозначен «Черновик, не подтверждён».
- Компонентные тесты сначала завершались `MODULE_NOT_FOUND` до создания `composition-view` и `composition-form`. После реализации 7/7 проходят: 2×3 отображается как «на родителя 3 / на изделие 6», предок и потомок оба могут быть отмечены, read-only скрывает правку, подтверждённая ревизия не выглядит черновиком, селектор родителя не предлагает PART или собственное поддерево, целое количество ограничено 1–1 000 000, неизвестный результат подтверждения повторяет тот же UUID.
- Product page сохраняет прежний default tab `tasks`, добавляет `Состав` без изменения `TasksTab`/`EngineeringFund`, а выбор исторической ревизии сохраняет текущие URL-параметры. Формы используют существующие Dialog, Input, Checkbox, Button и ConfirmDeleteDialog. Высота длинного диалога ограничена viewport, кнопки ≥48 px, иконные действия ≥44 px; вложенные карточки переносят длинные названия. Предупреждение удаления модуля объясняет удаление дочерних строк.
- `pnpm --dir apps/web exec tsx --test tests/product-composition-default-view.test.ts tests/product-composition-view.test.tsx tests/product-composition-form.test.ts`: 7/7 pass. `tsc --noEmit` и targeted ESLint: pass.

Фактические клавиатурные действия, адаптивность 360×800/390×844/1440×900 и native/browser проверка серверных действий остаются pending; по статической разметке они не считаются принятыми.
# Дополнительный review root, 29.09.2026

Обычный `pnpm test` ранее пропускал `.test.tsx`; команда расширена, три SSR-теста теперь входят в локальный и CI suite.

В отдельной browser-проверке компонента с CSS production build выявлен RED на дереве глубиной 16: вложенные отступы сжимали карточки и кнопки выходили за ширину экрана. Карточки больше не накапливают padding, отступы дерева ограничены первыми двумя уровнями; группы используют native `details/summary` с клавиатурным раскрытием. После исправления `tests/composition-layout-browser.tsx` проходит на 360×800, 390×844 и 1440×900: кнопки внутри экрана, горизонтального переполнения нет, Enter сворачивает и раскрывает группу. Root просмотрел снимки верхней и нижней части на 360 px и нижней части на 390 px. Артефакты текущего прогона: `%TEMP%/pero-composition-layout-y2gi6I/`.

Это проверка компонента без сети, CRM-сервера и БД. Она не заменяет native/browser приёмку действующей CRM по QA-плану. После исправлений повторены build, TypeScript, lint (0 ошибок, прежний existsSync warning), общий suite **390/390 CRM + 9/9 bot** и strict OpenSpec. Повтор component browser уже с окончательным CSS также PASS; артефакты `%TEMP%/pero-composition-layout-WgtqC9/`, root дополнительно просмотрел desktop 1440×900. Ни один из этих результатов не является native/staging приёмкой.

Дополнительно вместо шрифта-заглушки в component preview встроены реальные Roboto WOFF2 из локальной production-сборки. Повтор трёх размеров экрана PASS; root просмотрел 360 px bottom, кнопки и подписи читаются. Артефакты `%TEMP%/pero-composition-layout-yBRVwN/`; после изменения test helper прошли TypeScript и scoped ESLint. Runtime приложения и SQL не менялись.
