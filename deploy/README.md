# Прод-стек на офисном сервере (LXC crm, 192.168.0.20)

Папка `/opt/crm`:

```
/opt/crm/
  .env                     # DB_PASSWORD, AUTH_SECRET, TZ, CRM_IMAGE_TAG=main (chmod 600!)
  docker-compose.yml       # = deploy/docker-compose.server.yml (image: ghcr.io/…, pull-модель)
  Caddyfile                # = deploy/Caddyfile.lxc
```

Код в репо на сервере НЕ нужен: образ собирает GitHub CI (`main` → тег `main`,
`staging` → тег `staging`), сервер забирает его watcher-кроном каждые 5 минут
(`docker compose pull web && docker compose up -d web` — пересоздание только при
смене образа; миграции накатываются при старте контейнера). Приватный образ:
один раз `docker login ghcr.io` с PAT (read:packages).

Подъём: `cd /opt/crm && docker compose up -d`.
Обновление: автоматически watcher'ом ≤5 мин после зелёного CI на нужной ветке
(или вручную теми же двумя командами).
Откат: `docker pull ghcr.io/navasiolau/pero_crm:sha-<коммит>` +
`CRM_IMAGE_TAG=sha-<коммит>` в .env → `docker compose up -d web`.

- БД: имя `crm`, пользователь `crm`, пароль в `.env` (формат
  `postgresql://crm:…@db:5432/crm` из контракта ARCHITECTURE.md).
- VPS (103.167.18.41) терминирует HTTPS и проксирует `crm.peromebel.by` →
  `192.168.0.20:80` через WireGuard-туннель (см. ARCHITECTURE.md).
- Перенос данных: `docs/DEPLOY.md` §3–4 (дамп + uploads в volume).
- Стейджинг: тот же compose с `CRM_IMAGE_TAG=staging` в `/opt/crm-staging`
  на CT 101 (192.168.0.30), публикуется как staging-crm.peromebel.by
  (basic auth на VPS); данные подтягиваются с прода скриптом
  `/opt/crm/refresh-staging.sh` (cron 03:30, вне репо — см. ARCHITECTURE.md).
