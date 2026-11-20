#!/bin/sh
set -eu

if [ "${PERO_DB_ENFORCE_RUNTIME:-0}" = 1 ]; then
  if [ -n "${DATABASE_MIGRATION_URL:-}${DB_PASSWORD:-}${POSTGRES_PASSWORD:-}${DIRECT_URL:-}${SHADOW_DATABASE_URL:-}" ]; then
    echo "CRM: migration credentials must stay outside the web process" >&2
    exit 1
  fi
  if [ "${PERO_DB_MIGRATE_ON_START:-0}" = 1 ]; then
    if [ "${PERO_DB_SKIP_MIGRATION:-0}" != 1 ]; then
      node apps/web/runtime-migrate.mjs
    fi
    unset PERO_DB_MIGRATOR_ROLE PERO_DB_MIGRATION_DATABASE PERO_MIGRATION_EXPECTED_DB_IP PERO_DB_SKIP_MIGRATION
    export HOME=/home/node
    exec setpriv --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
      --reuid=1000 --regid=1000 --clear-groups node apps/web/runtime-web.mjs
  fi
else
  prisma migrate deploy --schema apps/web/prisma/schema.prisma
fi
exec node apps/web/server.js
