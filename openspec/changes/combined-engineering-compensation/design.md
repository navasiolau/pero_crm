# Design
## Context
Текущий completion-core выбирает PIECE по payScheme получателя, direct engineering completion платит отдельным PRODUCT_PERCENT_ENGINEERING snapshot. Переход проекта больше не начисляет старый PERCENT_PROJECT. Role priority в этих ядрах отсутствует.
## Goals / Non-Goals
Goals: проверить выбранную схему и независимость инженерного процента на одном совмещённом аккаунте.
Non-Goals: новые зарплатные схемы, backfill и переписывание фактов.
## Decisions
Выявлена недостающая граница: pure ENGINEER сейчас получает PIECE/оборот. Shared predicate исключает только точный singleton ENGINEER, без hasENGINEER запрета для совмещённых ролей. Turnover writer и кандидатный preview используют одну границу; historical debt/entries/payouts не фильтруются. По решению владельца старое неоплаченное обязательство grandfathered только при валидном TASK_FIXED: matching group/work IDs, сохранённые cent-scale shareAmount/budget, сумма не больше бюджета, shareUnits 1..1000000, не physicalOnly. Оно платится по сохранённой сумме, включая changed/null current unitPrice; валютные и dedupe guards сохраняются. Просто groupId, коэффициент, PHYSICAL_ONLY, STAGE_PREVIEW и corrupted snapshot не являются grant. Проверяем настоящие денежные ядра с транзакционными fixtures и exact amounts/replay. Административный выбор схемы не нормализуется по старшей роли. Покрытые этапом работы сохраняют защиту от двойной оплаты; только самостоятельная обычная работа начисляет PIECE. Месячные итоги суммируют отдельные записи.
## Risks / Trade-offs
Тесты не заменяют native БД/стaging приёмку → координатор выполняет эти проверки отдельно. Отсутствие legacy project writer необходимо проверять существующими регрессиями → запускаем связанные suites.
