# Design

## Context

Администратору нужен общий настраиваемый набор значений новых КП.

## Goals / Non-Goals

Goals: Настройки подписи КП. Non-Goals: изменения других бизнес-процессов.

## Decisions

Страница /settings/kp и серверные actions с общей настройкой OrgSetting kp.signatureDefaults. Формат совместим с 205: JSON revision и values {managerName,managerRole,managerPhone,warrantyMonths,footer}. Сохранение под advisory lock с UUID receipt, CAS revision и аудитом. ADMIN проверяется сервером. Срок гарантии — положительное целое; изменение срока синхронизирует стандартную фразу подвала так же, как раздел 5. Миграция таблиц не нужна.

## Risks / Trade-offs

Гонки, повторы и ошибки проверяются целевыми тестами. Production-данные и опубликованные документы не меняются во время локальной реализации.
