# Spec Delta

## MODIFIED Requirements

### Requirement: Видимость назначенного изделия

Система SHALL предоставлять текущему назначенному инженеру read карточки/списков/опций/поиска вDESIGN иPRODUCTION. Пользовательскиефильтры SHALL толькосужатьэтодоступ; участникстаройоплаты безcurrentassignment SHALL не получать этотgrant. Дополнительныйread PRODUCTION SHALL не расширять technicaledit/finance права.

#### Scenario: Свои и чужие изделия разных этапов
- **WHEN** текущий инженер открывает ownDESIGN/ownPRODUCTION и foreignDESIGN/ownDELIVERY
- **THEN** доступны только ownDESIGN/PRODUCTION, остальные ограничены existingroleunion

#### Scenario: Подмена фильтра
- **WHEN** инженер фильтрует по чужому инженеру
- **THEN** доступ не расширяется; фильтрPRODUCTION возвращает толькоcurrentownPRODUCTION
