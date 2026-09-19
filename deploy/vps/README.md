# Восстановление VPS (расходник по архитектуре)

Полное состояние VPS: **приватный ключ WireGuard** (в хранилище владельца,
файл `vps.key` = `IDDNL9kUF/…=`) + **Caddyfile** (в репо `deploy/vps/Caddyfile`,
вкомпилен в `vps-restore.sh`). Ни БД, ни файлов, ни сертификатов: LE
перевыпускается сам. Время восстановления ≈ **10 минут**, из них 5 — заказ VPS.

## Чеклист восстановления

1. **Заказать VPS** (Ubuntu 24.04, root). Пусть будет новый IP `NEW_IP`.
2. **Залить и запустить скрипт** (с ПК админа):
   ```powershell
   scp D:\Projects\pero_crm_v2\deploy\vps\vps-restore.sh root@NEW_IP:/root/
   ssh root@NEW_IP "bash /root/vps-restore.sh '<КЛЮЧ-ИЗ-ХРАНИЛИЩА>'"
   ```
   Скрипт: пакеты (wireguard/caddy/ufw) → wg0.conf → Caddyfile → ufw
   (22/80/443/51820) → сервисы. Тот же ключ = **офисная сторона не трогается**.
3. **Если IP сменился** — обновить A-записи в cp.hoster.by (ручные, TTL 300):
   `crm.peromebel.by`, `auth.peromebel.by`, `staging-crm.peromebel.by` → `NEW_IP`.
4. **Endpoint на pve** (одна команда с ПК админа):
   ```powershell
   ssh root@192.168.0.10 "sed -i 's/^Endpoint = .*/Endpoint = NEW_IP:51820/' /etc/wireguard/wg0.conf && systemctl restart wg-quick@wg0"
   ```
5. **Проверка** (2–3 минуты): с телефона на мобильном интернете
   `https://crm.peromebel.by` (замок = LE выпустился) и
   `https://staging-crm.peromebel.by` (basic auth: `staging` / пароль из хранилища).
   Из дома: `ssh root@103.167.18.41` → `wg show` — handshake от офиса ≤25 сек.

## Что НЕ входит в восстановление (следующие этапы по архитектуре)

- Uptime Kuma — развёрнут на VPS (01.09.2026), но его volume `kuma-data`
  в `vps-restore.sh` НЕ входит: при пересоздании VPS ставится заново,
  мониторы настраиваются вручную (или вкомпилить в скрипт).
- Xray/прокси сотрудников, auth.peromebel.by (Authentik) — на VPS ещё нет;
  при появлении их конфиги добавлять в этот скрипт.

## Заметки

- Хеш basic auth в Caddyfile не секрет (однонаправленный); пароль — в хранилище.
- Если ключ потерян: сгенерировать новую пару на VPS (`wg genkey`), публичный
  вписать в `[Peer] PublicKey` на pve — и наоборот; то и другое за 2 минуты.
- `22/tcp` на VPS остаётся открытым до этапа NetBird (см. ARCHITECTURE.md).
