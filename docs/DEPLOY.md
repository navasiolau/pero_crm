# Развёртывание PERO CRM v2 на сервере

Стек целиком поднимается Docker'ом: **postgres 16** (БД), **app** (Next.js 15,
standalone-сборка, при старте сам применяет миграции), **caddy** (reverse-proxy,
авто-HTTPS по домену). Сервисы app и caddy активируются профилем `prod`.

```
интернет ── 80/443 caddy ── app:3000 ── postgres:5432 (внутри сети compose)
```

## 0. Требования к серверу

- Linux (Ubuntu/Debian — проверялось на этой базе), 2+ GB RAM (сборка образа
  требует ~2 GB; можно собирать иначе через `docker compose build` локально и
  переносить образ).
- Docker + compose-плагин: `curl -fsSL https://get.docker.com | sh`
- Домен, указывающий на сервер (A/AAAA-запись), открыты порты **80 и 443**.
- Исходящий интернет из контейнеров: курс валют тянется с `api.nbrb.by`
  (НБ РБ) в момент внесения прихода/расхода.
- Часовой пояс сервера — Europe/Minsk (месяцы зарплаты, таймеры, «дней на
  этапе» считаются по локальному времени; в compose `TZ` уже задаётся).
- **Legacy-база (5432) на сервере НЕ нужна** — миграция импорта корректно
  пропускает импорт, если источника нет.

## 1. Код

Серверу репозиторий НЕ нужен: CI собирает образ и публикует в GHCR, сервер
забирает его watcher'ом (см. `deploy/README.md`). Коммит/пуш в `main` →
зелёные тесты → образ `ghcr.io/navasiolau/pero_crm:main` → на прод поднимется
сам ≤5 минут. Стек на сервере: только `.env`, `docker-compose.yml`
(из `deploy/docker-compose.server.yml`), `Caddyfile` (из `deploy/Caddyfile.lxc`)
и скрипты watcher/refresh.

## 2. .env

Файл `.env` в корне (в git не входит, compose читает его обязательно):

```bash
cp .env.example .env
# секрет сессий Auth.js:
openssl rand -base64 32   # вставить в AUTH_SECRET
# домен для Caddy (авто-HTTPS Let's Encrypt):
#   CADDY_DOMAIN="crm.example.by"
```

| Переменная | Кому нужна | Примечание |
|---|---|---|
| `AUTH_SECRET` | app | обязательна, генерируется `openssl rand -base64 32` |
| `CADDY_DOMAIN` | caddy | домен сайта; `localhost` — самоподписанный сертификат |
| `TZ` | app | по умолчанию Europe/Minsk |
| `DATABASE_URL` | app | задавать не нужно — compose подставляет `postgres:5432` |
| `S3_ENDPOINT` | app | MinIO/S3 (`http://192.168.0.33:9000` в текущей инфраструктуре); **без переменной файлы пишутся на локальный диск** (fallback) |
| `S3_BUCKET` | app | `pero-crm` (прод) / `pero-crm-staging` (стейджинг) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | app | креды MinIO (у владельца в хранилище) |

### Стейджинг vs продакшен

Стек стейджинга — отдельный CT 101 (`/opt/crm-staging`), свои `.env`,
volumes и БД. Отличия окружений:

| | Прод (CT 100) | Стейджинг (CT 101) |
|---|---|---|
| `CRM_IMAGE_TAG` | `main` | `staging` |
| База | `crm`, живые данные | `crm`, копия прода (nightly refresh 03:30) |
| `S3_BUCKET` | `pero-crm` | `pero-crm-staging` (зеркалится из прода тем же refresh) |
| Домен | crm.peromebel.by (TLS на VPS) | staging-crm.peromebel.by (TLS + basic auth на VPS) |

Выкатка: ветка `staging` → CI → стейджинг (проверка) → merge в `main` → CI →
прод. Ночной refresh (`/opt/crm/refresh-staging.sh`, вне репо) переносит на
стейджинг и БД, и файлы: дамп + `mc mirror --overwrite --remove`
`peros3/pero-crm` → `peros3/pero-crm-staging` (тестовые объекты стейджинга
сверх зеркала удаляются — потому тестировать загрузки нужно с расчётом на
ночной сброс).

## 3. База данных (дамп)

Данные переносятся дампом текущей базы (не «с нуля»: из пустой БД миграции
создадут только схему и админа, без данных импорта).

На машине с текущей базой:

```bash
docker exec pero_crm_pg pg_dump -U pero -d pero_crm -Fc -f /tmp/pero_crm.dump
docker cp pero_crm_pg:/tmp/pero_crm.dump ./pero_crm.dump
```

На сервере:

```bash
docker compose up -d postgres          # дождаться healthy (docker compose ps)
docker cp ./pero_crm.dump pero_crm_pg:/tmp/pero_crm.dump
docker exec pero_crm_pg pg_restore -U pero -d pero_crm --clean --if-exists /tmp/pero_crm.dump
```

`pg_restore --clean` безопасен на пустой базе. Миграции уже применены в дампе
(таблица `_prisma_migrations`) — при старте app выполнит `prisma migrate
deploy`, увидит их и пропустит.

## 4. Файлы (uploads)

Хранилище — папка `uploads/<projectId>/…` (загруженные фото, чертежи, b3d…),
где `projectId` = номер проекта («205»). В контейнере это named-volume
`uploads` → **`/app/apps/web/uploads`** (переживает пересборку образа).
Внимание: standalone `server.js` делает `process.chdir(__dirname)`, поэтому
внутри контейнера `process.cwd() = /app/apps/web` — маунт и `docker cp` должны
целиться в `/app/apps/web/uploads`, иначе API отдаст «Файл не найден на диске».
Скопировать содержимое `apps/web/uploads/` с текущей машины на сервер и залить
в volume:

```bash
# на сервере, после первого старта контейнера app (п. 5):
docker cp ./uploads/. pero_crm_app:/app/apps/web/uploads/
```

Альтернатива — сразу наполнить volume: `docker volume inspect pero_crm_v2_uploads`,
скопировать файлы в его реальный путь (нужен root).

Важно: дамп БД и папку uploads снимать **после** миграций
`20260901140000_normalize_project_numbers` и `20260901150000_clean_identifiers` —
там id проектов уже равны номерам, и имена папок совпадают с id. Если вдруг
переносится старый дамп/старые папки (с именами `legacy_project_*`), сначала
запустите на машине-источнике `pnpm --filter @pero/web exec tsx scripts/rename-uploads-folders.ts`.

## 5. Запуск

```bash
docker compose --profile prod up -d --build
docker compose --profile prod ps        # все три сервиса Up (healthy)
docker compose logs -f app              # «All migrations have been successfully applied» + Ready
```

Что происходит при старте app: `prisma migrate deploy` (накатывает недостающие
миграции) → `node apps/web/server.js` (standalone). После пересборки образа
загруженные файлы сохраняются (volume `uploads`), БД — (volume `pgdata`).

## 6. Проверка

1. `https://<домен>` — страница входа, замок в браузере (сертификат выпустит Caddy).
2. Вход: `mikita.navasiolau@gmail.com` (админ; пароли импортированных
   сотрудников — `pero2026`, сменить через /settings/users).
3. /projects — канбан: сверху новые номера (205…), фильтры, галочка
   «Только незавершённые» включена по умолчанию.
4. /products — изделия: канбан/таблица, drag статусов.
5. Загрузка файла в карточке проекта → файл появился в `uploads/<projectId>/`.
6. Внесение прихода в «Финансы» — курс подтянулся с НБ РБ.

## 7. Обновление версии

Автоматически: push в `main` → CI (тесты → сборка → GHCR) → watcher на сервере
забирает образ ≤5 минут и перезапускает контейнер (`migrate deploy` накатывает
миграции при старте). Лог watcher'а: `/var/log/watch-deploy.log`.

Вручную (если нужно сразу): `cd /opt/crm && docker compose pull web && docker compose up -d web`.
Откат: `CRM_IMAGE_TAG=sha-<коммит>` в `.env` → `docker compose up -d web`.
БД и файлы не трогаются.

## 8. Бэкапы (настроить сразу)

```bash
# БД — nightly (crontab):
0 3 * * * docker exec pero_crm_pg pg_dump -U pero -d pero_crm -Fc -f /tmp/dump.dump && docker cp pero_crm_pg:/tmp/dump.dump /var/backups/pero_crm-$(date +\%F).dump

# Файлы:
tar czf /var/backups/pero-uploads-$(date +\%F).tar.gz -C /var/lib/docker/volumes/pero_crm_v2_uploads/_data .
```

Восстановление БД — как в п. 3; файлов — распаковать tar в volume и
`docker cp` в контейнер.

## 9. Известные ограничения

- `pnpm db:seed` на сервере с реальными данными **не запускать** — затрёт их
  демо-данными.
- Резервные копии делаются средствами docker/pg_dump — volume `pgdata`
  «вживую» копировать нельзя.
- Первый выпуск сертификата Let's Encrypt требует доступных 80/443 и
  корректного DNS; при `CADDY_DOMAIN=localhost` браузер покажет предупреждение
  о самоподписанном сертификате.
