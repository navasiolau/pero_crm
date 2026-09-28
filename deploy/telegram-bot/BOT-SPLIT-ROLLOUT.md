# Разделение ботов: прод + стейджинг (CT110, без смены сети)

Статус 23.09.2026: ВНЕДРЕНО. Старый бот `@pero_crm_bot` — прод (.20/main), новый тестовый `@pero_crm_staging_bot` — staging (.30/staging). Оба healthy, каждый зарегистрирован в своей CRM (receipt `deploy/infra-recovery/evidence/bot-split-20260923.json`). Токены только на сервере (0600), в репозитории их нет. Старый одиночный `tgbot` и его крон отключены.

Решение владельца 23.09: один бот — прод, второй — стейджинг. Два бота с одним токеном запрещены (вечный `409 Conflict`).

## Что подготовлено (только исходники, live не тронут)

* `docker-compose.prod.yml` → `tgbot-prod`, `.env.prod`, health `/tmp/pero-telegram-bot-health-prod.json`, образ `main`.
* `docker-compose.staging.yml` → `tgbot-staging`, `.env.staging`, health `/tmp/pero-telegram-bot-health-staging.json`, образ `staging`.
* `.env.prod.example` / `.env.staging.example` — без секретов.
* `watch-deploy-prod.sh` / `watch-deploy-staging.sh` — раздельные кроны и логи.

## Команда владельцу (выполнено 23.09)

Владелец создал второго бота и передал тестовый токен. Остаток: хранить оба токена в Vaultwarden, тестовый токен был показан в чате — при желании обновить его у BotFather позже.

## Шаги исполнителя (выполнено 23.09)

1. На CT110: `/opt/telegram-bot-prod/.env.prod` (0600 root) + `/opt/telegram-bot-staging/.env.staging`, токены prod/staging раздельно, `CRM_BASE_URL` .20/.30.
2. `docker compose -f ... up -d` по очереди, проверка `register/session` в своей CRM, чужой токен даёт 401.
3. Два Kuma push-checks: `telegram-bot-prod polling/crm` + `telegram-bot-staging polling/crm`, порог 4, короткие 🔴/🟢.
4. `OrgSetting telegram.botUsername` в каждой CRM — свой username, кросс-регистр запретить.
5. Stage-only `CRM_API_TOKEN` создать после первого guarded refresh; общий токен отзывать только в staging. Prod-токен — отдельной ротацией с инвентаризацией consumers.
6. Переключение prod-бота — только после принятой полной точки (B04) + W07 refresh. Откат: `BOT_IMAGE_TAG=sha-<коммит>` в своём `.env.*`.

## Запреты

Не запускать prod и staging с одним `TELEGRAM_BOT_TOKEN`. Не смешивать `.env`. Не переключать прод до полной точки.
