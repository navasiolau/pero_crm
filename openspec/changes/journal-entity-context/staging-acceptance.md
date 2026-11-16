# Приёмка контекстных журналов №224

Root проверяет фактический staging SHA/image/health и берёт IDs трёх journal server actions из manifest этого образа. В счётчик ранних запросов включаются только `listJournal` и `listJournalFilterOptions`: существующие bell/прочие actions страницы не являются запросами журнала.

1. В административном контексте открыть существующий проект на обычной вкладке. «Журнал» — последний trigger, после плагинов. До нажатия journal-actions отсутствуют; после нажатия запросы передают `{kind:"project",id:<постоянный project.id>}`. Проверить прямой `?tab=journal` и сохранённый returnTo. Состав сравнить с reader: product-owned события исключены.
2. Открыть существующее изделие сверху страницы по его номеру. Продуктовых tabs не появилось. До достижения нижнего `[data-product-section="journal"]` journal-actions отсутствуют. Прокрутка вызывает запрос `{kind:"product",id:<постоянный product.id>}`; повторная прокрутка не создаёт вторую initial загрузку. Фильтры и «Сбросить» сохраняют product scope.
3. В обеих карточках открыть строку и кнопку сравнения, подтвердить общий компонент №223 и полный dialog. На телефоне проверить нижний раздел, горизонтальное переполнение и возможность прокрутки/закрытия.
4. В контекстах DIRECTOR и остальных проверяемых ролей страницы не содержат trigger/section/entity-journal и не вызывают journal-actions. `?tab=journal` проекта возвращает обычную доступную вкладку. Прямые reader actions №222 отклоняются до чтения данных.

Receipt: SHA/image, role matrix, project/product stable IDs и route aliases, counts journal-actions до/после, переданный scope, соответствие строк reader, screenshots и результат визуальной проверки. Auth headers/cookies/secrets не записывать. Source tests и synthetic UI не подменяют это подтверждение.
