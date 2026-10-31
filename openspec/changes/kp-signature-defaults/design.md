# Design

## Context

Новые КП создаются без сохранённых полей Подписи и реквизитов, а клиентские defaults расходятся с серверным снимком.

## Goals / Non-Goals

Goals: Инициализация подписи КП. Non-Goals: изменения других бизнес-процессов.

## Decisions

Общий серверный initializer в транзакции создания после проверки replay. Общий ключ OrgSetting kp.signatureDefaults, JSON revision и values {managerName,managerRole,managerPhone,warrantyMonths,footer}. При отсутствии настройки используются значения текущего шаблона; пустые явно переданные строки сохраняются. Чтение старых КП не применяет новые defaults.

## Risks / Trade-offs

Гонки, повторы и ошибки проверяются целевыми тестами. Production-данные и опубликованные документы не меняются во время локальной реализации.
