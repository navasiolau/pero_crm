#!/bin/bash
# =====================================================================
# ВОССТАНОВЛЕНИЕ VPS PERO (публичный край) на свежей Ubuntu 24.04.
# VPS по архитектуре — расходник: всё его состояние = 2 конфига + 1
# приватный ключ (в хранилище владельца). Скрипт самодостаточен.
#
# Запуск на НОВОМ VPS (root):
#   bash vps-restore.sh '<VPS_PRIVATE_KEY>'
# Ключ брать из хранилища (строка вида IDDNL9kUF/...=, файл vps.key).
# Тот же ключ = офисная сторона (pve) не трогается.
# После смены IP: обновить A-записи crm/auth/staging-crm в cp.hoster.by
# и Endpoint на pve (команда в deploy/vps/README.md).
# =====================================================================
set -euo pipefail

KEY="${1:-}"
if [ -z "$KEY" ]; then
  echo "Использование: bash vps-restore.sh '<VPS_PRIVATE_KEY>'"; exit 1
fi
# Нормализация ключа (убрать случайные кавычки/пробелы)
KEY=$(echo "$KEY" | tr -d '"' | tr -d "'" | awk '{print $1}')
echo "$KEY" | grep -q '^[A-Za-z0-9+/]\{43\}=$' || { echo "Ключ не похож на WireGuard base64 (44 симв.)"; exit 1; }

echo "== 1/5 Пакеты (wireguard, caddy, ufw) =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard ufw debian-keyring debian-archive-keyring apt-transport-https curl gpg >/dev/null
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy >/dev/null

echo "== 2/5 WireGuard =="
install -m 600 /dev/null /etc/wireguard/vps.key
echo "$KEY" > /etc/wireguard/vps.key
cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = 10.200.200.1/24
ListenPort = 51820
PrivateKey = $KEY

[Peer]
PublicKey = kTayHq924q3qIPDbutDTjUHGOVq5lRTTuX5JOCaY3UA=
AllowedIPs = 10.200.200.2/32, 192.168.0.0/24
EOF
chmod 600 /etc/wireguard/wg0.conf

echo "== 3/5 Caddy =="
cat > /etc/caddy/Caddyfile <<'EOF'
{
	# auth.peromebel.by добавим в шаге Authentik
}

crm.peromebel.by {
	reverse_proxy 192.168.0.20:80
}

staging-crm.peromebel.by {
	basic_auth {
		staging $2a$14$loxh/pLiXQCMERQWX8BVc.F9H3fXOkXfgGZ/3MerSdyn/sGspnqhW
	}
	reverse_proxy 192.168.0.30:80
}
EOF

echo "== 4/5 Файрвол (ufw) =="
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 51820/udp >/dev/null
echo y | ufw enable >/dev/null 2>&1 || true

echo "== 5/5 Сервисы =="
systemctl enable --now wg-quick@wg0 >/dev/null 2>&1
systemctl restart wg-quick@wg0
systemctl enable --now caddy >/dev/null 2>&1
systemctl restart caddy

sleep 3
echo "== Проверка =="
wg show wg0 | grep -E 'interface|listening' || true
ss -tlnp | grep -E ':80 |:443 ' || true
ufw status | head -6
echo ""
echo "ГОТОВО. Дальше (если IP сменился):"
echo " 1) A-записи crm/auth/staging-crm.peromebel.by -> новый IP (cp.hoster.by)"
echo " 2) ssh root@192.168.0.10 — см. Endpoint-команду в deploy/vps/README.md"
echo " 3) Сертификаты Let's Encrypt Caddy перепустит сам в течение минуты."
