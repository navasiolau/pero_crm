# Proposal
## Why
Физическое удаление изделия может удалять зависимые данные либо запрещает действие из-за истории. План55 требует скрыть изделие из работы без потери файлов и начислений. Уточнение владельца 04.11.2026: резервирование номера изделия было ошибочным требованием; №211 сохраняет историю по ID и последовательность действующего состава.
## What Changes
- Logical tombstone deletedAt/deletedById foundation54 вместо любых cascade/delete.
- Manager-only typed CAS expectedUpdatedAt+UUID/replay, active timer refusal без остановки/начисления.
- Сплошная красная урна «Удалить» в карточке с общим подтверждением и точным предупреждением о сохранении истории.
## Capabilities
### New Capabilities
- `product-soft-delete`: сохранённая история изделия при удалении из работы.
### Modified Capabilities
Нет.
## Impact
Product delete core/action/contracts/UI и focused unit/native build-only QA. Schema/operational filters foundation54 переиспользуются. Project deletion56, Finance history59, suffix allocation не меняются. Root применяет runtime/Git/deploy.
