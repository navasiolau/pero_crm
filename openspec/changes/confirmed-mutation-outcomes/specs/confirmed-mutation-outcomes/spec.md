# Spec Delta

## Purpose

Подтверждение сохранённых изменений отделяется от отказа последующих эффектов и неизвестного результата commit, чтобы повтор первоначального намерения не создавал вторые денежные операции, статусы или таймеры и не откатывал интерфейс без доказательства.

## ADDED Requirements

### Requirement: Явный результат операции

Система SHALL различать подтверждённый COMMITTED, подтверждённый ROLLED_BACK и UNKNOWN. Возвращённый из mutation candidate и ошибка соединения MUST NOT сами по себе считаться подтверждением commit или rollback. UNKNOWN SHALL разрешаться exact durable receipt либо подтверждённым owned состоянием соответствующей команды; отсутствие или отказ сверки MUST сохранять UNKNOWN без автоматической mutation.

#### Scenario: Commit подтверждён
- **WHEN** сохранение статуса задачи или платежа подтверждено
- **THEN** клиент получает успешный ACK со стабильным result ID

#### Scenario: Отказ до commit
- **WHEN** операция прервана и rollback подтверждён
- **THEN** она остаётся ошибкой, время/статус/деньги/audit/outbox не меняются частично

#### Scenario: Ответ самого commit потерян
- **WHEN** mutation callback завершён, но результат commit неизвестен
- **THEN** candidate не выдаётся за success; exact подтверждённый proof возвращает прежний result ID, failed или absent proof оставляет UNKNOWN

### Requirement: Повтор именно исходного намерения задачи

Поддерживаемые web status actions SHALL закреплять actor, task, целевой статус, ручное время и один request UUID до подтверждения исходного намерения. Система SHALL сохранять receipt атомарно со статусом, временем, начислением, audit и event. Повтор того же actor/type/payload/UUID MUST NOT создавать повторные timer/money/status/audit/event/notifications. Изменённый payload или чужой actor SHALL получать отказ. Expected actor нового pinned intent MUST совпадать с текущим серверным авторизованным actor до любых receipt reads/writes; client hint MUST NOT предоставлять права. Legacy без UUID SHALL оставаться допустимым, но неподтверждённый результат MUST NOT объявляться безопасным автоматическим повтором.

#### Scenario: Потерян client ACK
- **WHEN** web повторяет тот же status intent после потери ответа
- **THEN** возвращается его исходный result ID без второй записи или эффекта

#### Scenario: Старый START после законного DONE
- **WHEN** первая IN_PROGRESS команда подтверждена, затем задача законно выполнена и прежний START UUID повторён
- **THEN** возвращается только minimal historical ACK/replayed с refresh; текущий DONE, timer, payroll/audit/event неизменны и старый requested status не выдаётся как текущий

#### Scenario: Подмена receipt
- **WHEN** тот же UUID передан другим actor либо с другим task/status/actualMinutes/type
- **THEN** сервер отказывает без изменения сущностей и не раскрывает чужие результаты

### Requirement: Существующий платёжный повтор сохраняется

Платёжный сервис SHALL использовать существующий actor-bound normalized fingerprint и receipt, возвращать исходный paymentId при confirmed replay и сохранять запрет повторного проведения удалённого платежа. Optional UUID SHALL оставаться совместимым; unreceipted UNKNOWN MUST NOT автоматически исполнять новую денежную команду. Валютные и исторические снимки MUST сохраняться.

#### Scenario: UNKNOWN и повтор со старым UUID
- **WHEN** web либо bot повторяет неподтверждённый платёж с тем же UUID и payload
- **THEN** подтверждённая receipt возвращает тот же paymentId; второй payment/audit/event не создаётся

#### Scenario: Изменённый или удалённый платёж
- **WHEN** ключ повторён с изменёнными реквизитами либо первоначальная операция удалена
- **THEN** проведение отклоняется и сохранённая история не пересчитывается

#### Scenario: UNKNOWN без ключа
- **WHEN** старый клиент без UUID получил unresolved UNKNOWN
- **THEN** сервер не повторяет mutation автоматически и не обозначает её rollback

### Requirement: Optional эффекты не меняют сохранённый ACK

После confirmed commit каждый dispatch, notification и cache effect SHALL выполняться независимо; его sync/async отказ SHALL регистрироваться безопасным кодом и не менять успешный ACK/result ID. Mandatory business validation, audit и outbox MUST NOT становиться optional effects. Четыре затронутых work/norm audit записи SHALL фиксироваться вместе с соответствующей существующей mutation.

#### Scenario: Каждый effect отказал отдельно
- **WHEN** dispatch, person/org notify либо каждый cache path по очереди отказывает после commit
- **THEN** ACK остаётся успешным с тем же result ID, остальные эффекты выполняются, persistent state не дублируется при повторе

#### Scenario: Обязательный audit отказал
- **WHEN** audit removeWork либо projectMaterial add/update/delete не сохраняется
- **THEN** соответствующая mutation откатывается целиком и клиент не получает success

### Requirement: UNKNOWN сохраняет намерение и действующий интерфейс

Web и bot SHALL сохранять первоначальный request/payload при UNKNOWN или потере transport response. Оптимистичный UI MUST NOT обозначать это confirmed rollback; повтор SHALL использовать старый UUID, а новые действия сохранять действующие права, переназначения, таймеры и историю. Штатный layout/styles и тексты успешных состояний SHALL сохраняться.

#### Scenario: UNKNOWN в компоненте
- **WHEN** клиент не получил подтверждение операции и нажимает повтор без изменения намерения
- **THEN** отправляется прежний UUID/payload; успешная сверка закрывает первоначальную операцию, а неисправная сверка оставляет понятную неопределённость

#### Scenario: Неавторизованный запрос
- **WHEN** пользователь или bot token не имеет действующего доступа к новой mutation либо запрашивает чужую receipt
- **THEN** сервер отклоняет действие, роли не расширяются и private финансовые/текущие данные не выдаются

#### Scenario: Смена аккаунта в другой вкладке
- **WHEN** старая вкладка с неподтверждённым intent и новым UUID без receipt отправляет повтор после смены серверной учётной записи
- **THEN** mismatch expected actor запрещает эту попытку без mutation и чужих данных; старый ACK не применяется к UI нового пользователя, а прежний UNKNOWN не объявляется rollback

#### Scenario: Действующие ограничения переназначения
- **WHEN** запрошено изменение assignee исторической инженерной работы либо выполнено разрешённое обычное переназначение
- **THEN** первый запрос отклоняется без writes, второй сохраняет IN_PROGRESS; фиктивный инженерный reset не вводится
