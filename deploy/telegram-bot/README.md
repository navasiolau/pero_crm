# Telegram-бот PERO CRM — развёртывание (LXC tgbot)

Бот — **изолированный сервис**: отдельный LXC на pve, только исходящие
соединения (Telegram API + CRM по LAN), входящих портов нет. Логика бота —
`apps/telegram-bot` в монорепо; данные — только в CRM (через REST
`/api/v1/bot/*` с сервисным Bearer-токеном).

**Факт развёртывания (13.09.2026): CT 110 `tgbot`, 192.168.0.34** (ID 105
занят остановленным leftover `restore-test` и сам прописан на .34 — при его
старт будет конфликт адресов; leftover подлежит удалению решением владельца).
Сейчас бот работает в staging-режиме (CRM_BASE_URL=http://192.168.0.30,
BOT_IMAGE_TAG=staging); переключение на прод — поменять в .env
CRM_BASE_URL=http://192.168.0.20, продовый CRM_API_TOKEN и BOT_IMAGE_TAG=main,
`docker compose up -d`.

**Доступ к боту.** Пользователь активной учётной записи привязывает Telegram одноразовой ссылкой из профиля CRM. Права команд определяет CRM по текущим ролям.

## 1. Подготовка в CRM (один раз)

1. **Создать бота** у @BotFather → получить токен (`TELEGRAM_BOT_TOKEN`).
2. **Сервисный токен CRM**: в CRM под админом → *Настройки → API и токены* →
   создать токен со scope **`read` и `write` оба** (`CRM_API_TOKEN`). Только `write`
   недостаточно: чтение привязки, проектов, справочников и карточек идёт через
   `read`, без него бот привязывается («Привязано»), но дальше молчит на все
   команды. Показывается один раз — сразу в хранилище.

## 2. Создать контейнер (на pve)

По образцу crm-staging: unprivileged, nesting=1 (docker), onboot.
Хранилище — `local-zfs` (не local-lvm).

```bash
ssh root@192.168.0.10   # pve
pct create 110 local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst \
  --hostname tgbot --net0 name=net0,bridge=vmbr0,ip=192.168.0.34/24,gw=192.168.0.1 \
  --unprivileged 1 --features nesting=1 --cores 1 --memory 1024 --swap 512 \
  --rootfs local-zfs:8 --onboot 1 --start 1
```

Внутри (по образцу crm): docker (`curl -fsSL https://get.docker.com | sh`),
`docker login ghcr.io` (PAT владельца, read:packages).

## 3. Конфиг и запуск

```bash
mkdir -p /opt/telegram-bot && cd /opt/telegram-bot
# скопировать deploy/telegram-bot/docker-compose.server.yml → docker-compose.yml
cat > .env <<'EOF'
TELEGRAM_BOT_TOKEN=<токен от BotFather>
CRM_BASE_URL=http://192.168.0.20
CRM_API_TOKEN=pero_<сервисный токен>
EOF
docker compose up -d
```

Креды — владельцу в хранилище (Vaultwarden).

## 4. Watcher-крон (pull-модель деплоя)

```bash
cat > /etc/cron.d/watch-deploy-bot <<'EOF'
*/5 * * * * root /opt/telegram-bot/watch-deploy.sh >> /var/log/watch-deploy-bot.log 2>&1
EOF
cat > /opt/telegram-bot/watch-deploy.sh <<'EOF'
#!/bin/sh
cd /opt/telegram-bot
CURRENT_ID=$(docker compose images bot -q 2>/dev/null)
docker compose pull bot -q
NEW_ID=$(docker compose images bot -q 2>/dev/null)
if [ "$CURRENT_ID" != "$NEW_ID" ]; then
  echo "$(date -Is) pull: новая версия ($CURRENT_ID -> $NEW_ID), up -d"
  docker compose up -d bot
fi
EOF
chmod +x /opt/telegram-bot/watch-deploy.sh
```

Откат: в `.env` добавить `BOT_IMAGE_TAG=sha-<коммит>` → `docker compose up -d`.

## 5. Проверка

- `docker logs tgbot` → `[bot] запущен как @<username>` и
  `[bot] зарегистрирован в CRM` (при старте бот пишет @username в CRM —
  после этого в профиле появляется рабочая ссылка привязки).
- В CRM: меню пользователя → **Telegram** → «Получить ссылку» → открыть бота
  → приветствие с именем и ролью.
- Менеджер: `/новый_проект`, `/проект <номер>`, `/проекты`.
- Бухгалтер: `/финансы`, `/приход`, `/расход` и `/закупка`.
- Непривязанный чат без действующего кода: бот молчит. Привязанный пользователь при нехватке прав получает единый отказ.
- `/команды` показывает доступные операции. Складские операции открываются через `/выдать_материал`, `/возврат_на_склад` и `/приход_на_склад`. В диалоге «Назад» сохраняет черновик, «Отменить всё» завершает заполнение.

## Наблюдаемость

HTTP health-сервер реализован в `apps/telegram-bot/src/health.ts`;
его состояние проверяется тестами сервиса. Настройки внешнего мониторинга
относятся к отдельному инфраструктурному проекту `D:\Projects\pero_infra`.
Требования новых итераций фиксируются отдельными OpenSpec changes.

## Финансы в Telegram

Mini App включается отдельно в каждом окружении. В окружении бота укажите `PERO_TELEGRAM_FINANCE_ORIGIN` с HTTPS-адресом CRM без пути. В окружении web укажите тот же origin, `PERO_TELEGRAM_FINANCE_BOT_TOKEN` от этого бота и отдельный `PERO_TELEGRAM_FINANCE_SESSION_SECRET` длиной от 32 символов. Staging использует отдельный экземпляр бота и собственные значения. Если параметров web нет, сессия закрыта, если параметра бота нет, кнопка скрыта.

Для staging используйте `https://telegram-staging.peromebel.by` как origin CRM и бота. Подготовьте DNS, TLS и маршрут из `deploy/vps/Caddyfile` к staging CRM. Web должен поддерживать гейт Telegram-сессии до активации маршрута. Проверьте доступность новой точки входа и отказ без Telegram-сессии до переключения бота. Основная CRM staging продолжает использовать Basic Auth.

При обновлении скопируйте актуальный `docker-compose.server.yml` стандартным процессом. Он монтирует именованный том `finance-state` в `/app/.finance-state`, чтобы команда `/проверить_операцию` могла использовать прежний UUID подтверждения после замены контейнера. Том содержит незавершённые операции и должен оставаться доступен после обновления. До приёмки проверьте фактический mount и доступ пользователя контейнера к нему, затем проверьте команду в разрешённом staging чате после замены контейнера.

В личном чате привязанного бухгалтера отправьте `/финансы` и нажмите «Финансы». Проверьте вход в WebView без пароля, реестры, загрузку и просмотр финансового файла, скачивание готовой ТТН и CSV. Журнал должен указывать фактического актёра. Проверьте отзыв доступа после отвязки. Для первичной и повторной привязки используйте одноразовую ссылку из меню «Telegram» в профиле CRM.

### Переход на проверку поколения привязки

После миграции прежние ожидающие одноразовые коды нужно запросить заново. Активные чаты и история сохраняются. Сервер принимает операции бота только при действующей привязке. Обновлённый бот передаёт выданный CRM заголовок `x-telegram-binding` и отклоняет кнопки прежней привязки. После совместной приёмки web и бота включите на стороне web `PERO_REQUIRE_TELEGRAM_BINDING_GENERATION=1`. Тогда отсутствие заголовка тоже приводит к отказу.

Версия бота с правами разделов из CRM требует ответа `user.access` от API. Сначала разверните совместимую CRM и проверьте её API, затем обновите бота.
