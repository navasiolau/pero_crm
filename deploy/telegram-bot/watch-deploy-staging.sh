#!/bin/sh
# Watcher staging-бота (pull-модель). Логи раздельно от prod.
cd /opt/telegram-bot-staging
CURRENT_ID=$(docker compose -f docker-compose.staging.yml images bot-staging -q 2>/dev/null)
docker compose -f docker-compose.staging.yml pull bot-staging -q
NEW_ID=$(docker compose -f docker-compose.staging.yml images bot-staging -q 2>/dev/null)
if [ "$CURRENT_ID" != "$NEW_ID" ]; then
  echo "$(date -Is) staging pull: новая версия ($CURRENT_ID -> $NEW_ID), up -d"
  docker compose -f docker-compose.staging.yml up -d bot-staging
fi
