# Восстановление PERO CRM из резервных копий (restic)

Репозиторий бэкапов: `E:\pero-backups\repo` на ПК админа (restic 0.19.1 в
`E:\pero-backups\bin\`). Пароль репо — в `E:\pero-backups\.repo-password` и в
надёжном хранилище владельца. **Утеря пароля = потеря всех бэкапов.**

## Состав каждого снапшота (тег pero-crm)

| Файл | Что внутри |
|---|---|
| `tmp/db.dump` | дамп БД прода (pg_dump -Fc, база `crm`) — онлайн-снапшот |
| `tmp/uploads.tar.gz` | файлы `uploads/<projectId>/…` (фото, чертежи, b3d) |
| `tmp/configs.tar.gz` | `/opt/crm/*` прода: `.env` (DB_PASSWORD, AUTH_SECRET), docker-compose.yml, Caddyfile, скрипты |
| `tmp/staging.tar.gz` | `/opt/crm-staging/*` целиком (CT 101) |
| `tmp/pve.tar.gz` | `/etc/wireguard` (ключи туннеля), `/etc/iptables/rules.v4`, `/etc/sysctl.d/99-wireguard.conf` (pve) |
| `tmp/vps.tar.gz` | `/etc/caddy/Caddyfile`, `/etc/wireguard` (ключи VPS-сервера) |

Планировщик (Windows): `PERO-CRM-Backup` — ежедневно 04:00 (догон при
выключенном ПК), `PERO-CRM-RestoreTest` — воскресенье 05:30 (см. ниже).
Retention: 7 дней / 4 недели / 6 месяцев.

## Команды (с ПК админа, PowerShell)

```powershell
$env:RESTIC_REPOSITORY = "E:\pero-backups\repo"
$env:RESTIC_PASSWORD_FILE = "E:\pero-backups\.repo-password"
$bin = "E:\pero-backups\bin\restic.exe"

& $bin snapshots                          # список снапшотов
& $bin ls latest                          # файлы последнего снапшота
# откат на конкретный снапшот: & $bin restore <snapshot-id> …
```

## Полное восстановление прода (новый/пересозданный CT crm)

Считаем, что Proxmox жив, репо доступно с ПК админа, но CT crm (192.168.0.20)
создан заново (пустой Ubuntu 24.04, Docker установлен). SSH-ключ — на месте.

1. **Скелет стека из бэкапа конфигов:**
   ```powershell
   & $bin restore latest --target "$env:TEMP\rt" --include /E/pero-backups/tmp/configs.tar.gz --include /E/pero-backups/tmp/vps.tar.gz
   scp -r "$env:TEMP\rt\E\pero-backups\tmp\configs.tar.gz" root@192.168.0.20:/tmp/
   ssh root@192.168.0.20 "mkdir -p /opt/crm && tar xzf /tmp/configs.tar.gz -C / && rm /tmp/configs.tar.gz"
   ```
   Восстановлены: `.env` (с боевыми DB_PASSWORD/AUTH_SECRET), compose, Caddyfile.
2. **Поднять БД:** `ssh root@192.168.0.20 "cd /opt/crm && docker compose up -d db"` → дождаться healthy.
3. **Залить БД:**
   ```powershell
   & $bin restore latest --target "$env:TEMP\rt" --include /E/pero-backups/tmp/db.dump
   scp "$env:TEMP\rt\E\pero-backups\tmp\db.dump" root@192.168.0.20:/tmp/db.dump
   ssh root@192.168.0.20 "docker cp /tmp/db.dump crm-db-1:/tmp/b.dump && docker exec crm-db-1 pg_restore -U crm -d crm --clean --if-exists /tmp/b.dump && docker exec crm-db-1 rm /tmp/b.dump"
   ```
4. **Поднять всё и залить файлы:**
   ```powershell
   ssh root@192.168.0.20 "cd /opt/crm && docker compose up -d"
   & $bin restore latest --target "$env:TEMP\rt" --include /E/pero-backups/tmp/uploads.tar.gz
   scp "$env:TEMP\rt\E\pero-backups\tmp\uploads.tar.gz" root@192.168.0.20:/tmp/
   ssh root@192.168.0.20 "docker compose stop web; tar xzf /tmp/uploads.tar.gz -C /var/lib/docker/volumes/crm_uploads/_data; rm /tmp/uploads.tar.gz; docker compose start web"
   ```
5. **Проверка:** `https://crm.peromebel.by` (вход, канбан, файл → 200). Имена
   папок uploads совпадают с id проектов (номера) — сверка не требуется.
6. **VPS-край** (если пересоздавался VPS): `deploy/vps/vps-restore.sh` с ключом
   из бэкапа (`vps.tar.gz → etc/wireguard/vps.key`), Caddyfile — из того же
   архива; либо просто развернуть `vps.tar.gz` на живой VPS в `/`.
7. **pve-туннель** (если пересоздавался wg0): `pve.tar.gz` → распаковать в `/`
   на хосте Proxmox, `systemctl restart wg-quick@wg0`.
8. **Staging** — отдельный CT 101: скелет из `staging.tar.gz` (`/opt/crm-staging`)
   → `docker compose up -d` → данные подтянутся `refresh-staging.sh` с прода.

## Еженедельный автотест восстановления

`E:\pero-backups\restore-test.ps1` (задача `PERO-CRM-RestoreTest`, вс 05:30,
догон при выключенном ПК):

1. `restic restore latest` → db.dump из репо
2. Разворачивает дамп во **временный postgres** в CT `restore-test`
   (CT 105, 192.168.0.34, onboot=0 — контейнер `rt-pg` создаётся и удаляется
   каждый прогон)
3. Проверяет данные: projects ≥ 100, products ≥ 1000, users ≥ 10
   (эталон: 174 / 1305 / 18 на 02.09.2026)
4. Отчёты:
   - **Telegram** (PeroUptimeBot, владелец): «✅ Тест восстановления из бэкапа
     прошёл штатно: <дата время> — projects=…, products=…, users=…»
   - **Kuma**: push-монитор «Тест восстановления из бэкапа (weekly)»
     (интервал 8 дней — алерт, если тест не прошёл за неделю)
5. Провал → «❌ … FAILED: <причина>» в Telegram + Down в Kuma

Ручной запуск теста: `powershell -File E:\pero-backups\restore-test.ps1`.
