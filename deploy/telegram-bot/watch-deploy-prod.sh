#!/bin/sh
# Watcher prod-бота (pull-модель). Логи раздельно от staging.
cd /opt/telegram-bot-prod
CURRENT_ID=$(docker compose -f docker-compose.prod.yml images bot-prod -q 2>/dev/null)
docker compose -f docker-compose.prod.yml pull bot-prod -q
NEW_ID=$(docker compose -f docker-compose.prod.yml images bot-prod -q 2>/dev/null)
if [ "$CURRENT_ID" != "$NEW_ID" ]; then
  echo "$(date -Is) prod pull: новая версия ($CURRENT_ID -> $NEW_ID), up -d"
  docker compose -f docker-compose.prod.yml up -d bot-prod
fi
