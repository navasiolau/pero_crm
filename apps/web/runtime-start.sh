#!/bin/sh
set -eu

if [ "${PERO_DB_ENFORCE_RUNTIME:-0}" = 1 ]; then
  if [ -n "${DATABASE_MIGRATION_URL:-}" ] || [ -n "${DB_PASSWORD:-}" ]; then
    echo "CRM: migration credentials must stay outside the web process" >&2
    exit 1
  fi
else
  prisma migrate deploy --schema apps/web/prisma/schema.prisma
fi

exec node apps/web/server.js
