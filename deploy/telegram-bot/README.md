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

**Доступ к боту (решение владельца):** привязать Telegram можно с любой
ролью, но команды работают только у ADMIN/DIRECTOR/MANAGER (комбинированные
роли — достаточно одной из них).

## 1. Подготовка в CRM (один раз)

1. **Создать бота** у @BotFather → получить токен (`TELEGRAM_BOT_TOKEN`).
2. **Сервисный токен CRM**: в CRM под админом → *Настройки → API и токены* →
   создать токен со scope `write` (`CRM_API_TOKEN`). Показывается один раз —
   сразу в хранилище.

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
- Менеджер: `/новый`, `/проект <номер>`, `/приход`, `/расход`.
- Работник/бухгалтер (без M/A/D ролей): бот отвечает отказом; `/стоп` работает.

## Что НЕ входит

- Kuma-монитор для tgbot — добавить при настройке (push-монитор по образцу
  других контейнеров).
- Исходящие уведомления о событиях CRM, ИИ-режим — следующие итерации
  (план-док «План плагина Telegram-бот.md», ред. 3).
