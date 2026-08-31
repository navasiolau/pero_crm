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

```bash
git clone <адрес-репозитория> pero_crm_v2
cd pero_crm_v2
```

Важно: перед клонированием все изменения должны быть закоммичены и запушены
(см. статус `git status` на машине разработки).

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

Хранилище — папка `uploads/<projectId>/…` (загруженные фото, чертежи, b3d…).
В контейнере это named-volume `uploads` → `/app/uploads` (переживает
пересборку образа). Скопировать содержимое `apps/web/uploads/` с текущей
машины на сервер и залить в volume:

```bash
# на сервере, после первого старта контейнера app (п. 5):
docker cp ./uploads/. pero_crm_app:/app/uploads/
# права не критичны (читает node), но volumes принадлежат root — ок.
```

Альтернатива — сразу наполнить volume: `docker volume inspect pero_crm_v2_uploads`,
скопировать файлы в его реальный путь (нужен root).

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

```bash
git pull
docker compose --profile prod up -d --build   # пересоберёт и перезапустит app
```

Накат миграций произойдёт при старте контейнера. БД и файлы не трогаются.

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
