# Proposal
## Why
Web-факт напоминания уже подтверждён, но личной Telegram-доставки нет. Нужен приватный outbox и отказ от слепого повтора неясной отправки без рассылки импортированным сотрудникам.
## What Changes
- Уникальный private TG outbox на namespace/confirmed fact и текущую личную привязку.
- Web65loop готовит очередь; существующий изолированный bot claim→preflight→send→ACK без переноса token в web.
- Текущие entry/flag/link/revision и exact test owner/chat/bot allowlist до claim/отправки.
- UNKNOWN при timeout/неясном ответе, bounded retry только подтверждённого429; никаких org broadcasts.
- DefaultOFF/unconfigured failclosed; настоящая Telegram-приёмка только с одобренным testchat отдельно.
## Capabilities
### New Capabilities
- `plan-telegram-reminders`: приватная подтверждаемая личная доставка с unknown-safe outbox и namespace isolation.
### Modified Capabilities
Нет.
## Impact
Новая TelegramReminderOutbox/migration110000, calendar queue/claim/authorize/ack cores/API, shared65loop и существующий bot job. Web reminders независимы от здоровья бота. Реальные credentials/env/Telegram автором не меняются и не вызываются.
