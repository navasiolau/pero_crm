# Восстановление PERO CRM из резервных копий (restic)

Репозиторий бэкапов: `E:\pero-backups\repo` на ПК админа (restic 0.19.1 в
`E:\pero-backups\bin\`). Пароль репо — в `E:\pero-backups\.repo-password` и в
надёжном хранилище владельца. **Утеря пароля = потеря всех бэкапов.**

## Состав каждого снапшота (тег pero-crm)

| Файл | Что внутри |
|---|---|
| `tmp/db.dump` | дамп БД прода (pg_dump -Fc, база `crm`) — онлайн-снапшот |
| `tmp/uploads.tar.gz` | файлы `uploads/<projectId>/…` (фото, чертежи, b3d) |
| `tmp/configs.tar.gz` | `/opt/crm/*` прода: `.env` (DB_PASSWORD, AUTH_SECRET, S3_*), docker-compose.yml, Caddyfile, скрипты |
| `tmp/staging.tar.gz` | `/opt/crm-staging/*` целиком (CT 101) |
| `tmp/pve.tar.gz` | `/etc/wireguard` (ключи туннеля), `/etc/iptables/rules.v4`, `/etc/sysctl.d/99-wireguard.conf` (pve) |
| `tmp/vps.tar.gz` | `/etc/caddy/Caddyfile`, `/etc/wireguard` (ключи VPS-сервера) |
| `tmp/nas.tar.gz` | NAS-файлы (Samba, `/srv/nas` — CT 103) |
| `tmp/s3.tar.gz` | S3-данные MinIO (`/srv/s3` — CT 104; **файлы CRM лежат теперь здесь**) |

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
   **Файлы CRM хранятся в S3 (MinIO, CT 104)** — uploads.tar.gz нужен только как
   источник исторических файлов; после распаковки прогнать их в бакет:
   ```powershell
   ssh root@192.168.0.20 "mc mirror --overwrite /var/lib/docker/volumes/crm_uploads/_data peros3/pero-crm"
   ```
5. **NAS/S3-данные** (CT 103/104, если пересоздавались): распаковать
   `nas.tar.gz` в `/srv/nas`, `s3.tar.gz` в `/srv/s3` соответствующих CT
   (`pct push` + tar), права: `chown root:employees` (setgid) для nas,
   `minio-user:minio-user` для s3/minio. Без keyfile `/root/.zdata.key` данные
   ZFS не расшифруются (см. ARCHITECTURE.md).
6. **Проверка:** `https://crm.peromebel.by` (вход, канбан, файл → 200). Имена
   папок uploads совпадают с id проектов (номера) — сверка не требуется.
7. **VPS-край** (если пересоздавался VPS): `deploy/vps/vps-restore.sh` с ключом
   из бэкапа (`vps.tar.gz → etc/wireguard/vps.key`), Caddyfile — из того же
   архива; либо просто развернуть `vps.tar.gz` на живой VPS в `/`.
8. **pve-туннель** (если пересоздавался wg0): `pve.tar.gz` → распаковать в `/`
   на хосте Proxmox, `systemctl restart wg-quick@wg0`.
9. **Staging** — отдельный CT 101: скелет из `staging.tar.gz` (`/opt/crm-staging`)
   → `docker compose up -d` → данные подтянутся `refresh-staging.sh` с прода.

## Еженедельный автотест восстановления (v3: полный стек + сверка с продом)

`E:\pero-backups\restore-test.ps1` (задача `PERO-CRM-RestoreTest`, вс 05:30,
догон при выключенном ПК). **Полный жизненный цикл временного контейнера:**

1. **Базлайн прода** (на момент старта теста): счётчики Project/Product/
   Client/User/File + вес из БД прода; число объектов и объём S3-бакета
   (`mc du`)
2. `restic restore latest` → `db.dump` + `uploads.tar.gz` из репо
3. На pve из **шаблона CT 109** клонируется **временный CT 108** и стартует
4. **Файлы**: uploads распаковываются в клона, считаются объекты и вес
5. **Полный стек**: postgres (восстановление дампа) + **CRM-приложение**
   (образ `ghcr.io/navasiolau/pero_crm:main`) — готовность проверяется
   HTTP-пробой login-страницы (probe=200) изнутри контейнера
6. Сверка с продом по каждому параметру: Проекты/Изделия/Клиенты/
   Пользователи/Файлы/вес — формат «+5.0% (+15)»; **малые отклонения не
   валят тест**, но всегда показываются; красный тест — при ошибке любого
   шага, провале минимумов или отклонении >25% по метрике
7. **Временный CT 108 уничтожается** (и при провале тоже)
8. **Подробный Telegram-отчёт**: снапшот (id, время), шаги цепочкой,
   полная таблица «тест vs прод» с процентами, вес файлов, длительность.
   Плюс push в Kuma (алерт, если тест не пришёл за 8 дней)

Ручной запуск: `powershell -File E:\pero-backups\restore-test.ps1`.
Шаблон CT 109 менять нельзя (источник клонов; docker login в GHCR + образы
postgres/CRM внутри); обновление: `pct enter 109` → `docker pull …`.
Probe готовности — `E:\pero-backups\rt-probe.sh` (node/fetch внутри CRM-контейнера).
