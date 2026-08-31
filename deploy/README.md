# Прод-стек на офисном сервере (LXC crm, 192.168.0.20)

Папка `/opt/crm`:

```
/opt/crm/
  .env                     # DB_PASSWORD, AUTH_SECRET, TZ (chmod 600!)
  docker-compose.yml       # = deploy/docker-compose.server.yml
  Caddyfile                # = deploy/Caddyfile.lxc
  app/                     # git clone репозитория (deploy-ключ GitHub)
```

Подъём: `cd /opt/crm && docker compose up -d --build`.
Обновление: `cd /opt/crm/app && git pull && cd .. && docker compose up -d --build`.

- БД: имя `crm`, пользователь `crm`, пароль в `.env` (формат
  `postgresql://crm:…@db:5432/crm` из контракта ARCHITECTURE.md).
- VPS (103.167.18.41) терминирует HTTPS и проксирует `crm.peromebel.by` →
  `192.168.0.20:80` через WireGuard-туннель (см. ARCHITECTURE.md).
- Перенос данных: `docs/DEPLOY.md` §3–4 (дамп + uploads в volume).
