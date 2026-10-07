# Проверка задачи92

Ветка bugfix/92 создана от staging fc1a4b9 и обновлена fast-forward до принятого3653b8e; владелец прямо разрешил commit/staging91–92. Изменены только ProductKanbanCard/ProjectKanbanCard и QA/OpenSpec.

- RED: реальная браузерная геометрия landscape при ширине300 имела высоту268 вместо150.
- GREEN:18 геометрических проверок product/project ×landscape/square/portrait ×1440/390/360. После исправления img/parent не резервируют вертикальных полос, отношение сторон совпадает с PNG с погрешностью<1px.
- Дополнительно3 сценария delayed/cache/error/empty, прежние клики, открытие/закрытие полноэкранного просмотра и disabled при dragging. Ошибка compact<130px, pageerrors0; cached изображения перед снимками действительно загружены.
- Протокол: .playwright-mcp/kanban92/receipt.json; desktop и390 PNG лично просмотрены.
- Исходный полный набор1275/1275 и повтор на интегрированной базе1280/1280, typecheck/lint/Next build/OpenSpec strict PASS.
- Подробные страницы, ProductHeroImage, preview/API/БД не изменены; live staging проверки ожидают разрешения и приёмки91.
