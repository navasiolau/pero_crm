# Design

## Context

См.proposal.md. В source d9aefd70 классификация находится в panel/controller/contracts/patch/query/direct completion и влияет на обычное Task completion через work-coverage. Status transaction сама не требует задач, но direct completion бросает ошибку классификации. SQL version_shape для calculationVersion2 фиксирует все проценты от партии; TS-only исправление не пройдёт настоящую БД.

## Goals / Non-Goals

**Goals:** убрать действующий классификатор целиком; одинаковая новая формула в предварительном отображении и записи; прошлые деньги неизменны; отсутствие работ/задач не препятствует статусам.

**Non-Goals:** автоматическое создание Work/Task, восстановление legacy денежных данных, новая схема обычной сдельной задачи, автоматическое списание из кассы, изменение ролевых разрешений статусов, production/main.

## Decisions

1. Retire workReview в публичном patch и DTO/controller/query, удалить work-review/work-coverage и их эффект на Task completion. Старые физические данные/исторические миграции не используются в новых операциях и не переписываются ради интерфейса.
2. Новые direct completions используют calculationVersion3. quantitySnapshot хранит фактическое количество, totalSnapshot полную стоимость price×quantity; sourceFundExact для ENGINEERING=price×rate/100, для остальных=totalSnapshot×rate/100. Сохранить целиком старые ветви SQL CHECK версии1/2; новая additive миграция расширяет допустимую форму версии3 без денежных UPDATE. Применение новой формулы к версии2 отвергнуто: иначе теряется однозначность старых фактов.
3. Существующий completion возвращается без изменения. Перед новой записью проверить исходный статус и существующую историю, предшествующие текущему переходу: ENGINEERING ранее достигнут в PRODUCTION/DELIVERY/INSTALLATION/DONE; ASSEMBLY в DELIVERY/INSTALLATION/DONE; INSTALLATION в DONE. Не использовать уже обновлённый целевой статус как историческое доказательство. Пропуск исторического этапа не создаёт деньги или выдуманные суммы. Отдельного массового backfill/ручного решения нет.
4. Сохранить общую статусную транзакцию для select/kanban, действующие права ролей и менеджерские перескоки. Работы, таймеры и Task status не являются дополнительными условиями этой транзакции.
5. Предварительный расчёт получает kind; ENGINEERING игнорирует множитель quantity, остальные используют его. Существующие frozen суммы версий1/2 показываются из snapshots, не пересчитываются новой формулой. Обычные inline saves остаются typed/serialized; удаляется только скрытый review controller/flush barrier.

## Risks / Trade-offs

- [Новая формула конфликтует с SQL] → новая версия3 и настоящий constraint test на существующей БД.
- [Возврат исторического изделия создаёт старые проценты] → pretransition status/history guard плюс существующая unique product/kind и замороженные completions.
- [Удаление UI оставит скрытый серверный/flush barrier] → удалить публичное поле/контроллер/читателей/coverage effect вместе и проверить реальные переходы.
- [Старый клиент отправит retired поле] → нормальная validation failure без записи и без поддержки старой классификации.

## Migration Plan

bugfix/23 от fresh origin/staging → meaningful RED→GREEN → typecheck/необходимые regression checks/strict OpenSpec → обычный commit/merge staging → CI → actual deployed SHA/image/health и focused native/browser acceptance. Миграция меняет CHECK, не суммы истории. Existing local/staging, без дампов/seed/reset/newDB/restic; W07/refresh неизменны. После создания версии3 не откатывать CHECK на старый; исправления вперёд. Main/production только по отдельному поручению.
