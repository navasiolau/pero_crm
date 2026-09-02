# PERO Vaultwarden — менеджер паролей компании (руководство)

Vaultwarden — самохостинговый сервер паролей, совместимый со всеми клиентами
Bitwarden. Адрес: **https://vault.peromebel.by** (работает из любой сети).
Пароли хранятся на сервере компании, в зашифрованном (AES-256) зеркальном
массиве; ежедневно резервируются.

## 1. Регистрация (один раз)

1. Откройте **https://vault.peromebel.by** → «Create account» / «Создать аккаунт».
2. Email — укажите ваш рабочий email (как в CRM).
3. **Master password** — мастер-пароль: это ЕДИНСТВЕННЫЙ пароль, который нужно
   помнить. Он шифрует всё содержимое и **не восстанавливается** (админ не
   может его сбросить — забытый мастер-пароль = потерянное хранилище).
   Рекомендация: длинная фраза (4–5 слов) + цифры, минимум 14 символов.
4. После входа можно включить **2FA**: «Settings → Security → Two-step Login»
   (рекомендуется TOTP-приложение, например Google Authenticator).

## 2. Браузерное расширение (основной сценарий)

1. Установите расширение **Bitwarden** для вашего браузера:
   Chrome/Edge: `https://chromewebstore.google.com/detail/bitwarden/`
   Firefox: `https://addons.mozilla.org/firefox/addon/bitwarden-password-manager/`
2. В расширении: шестерёнка (Settings) → **Server URL** → «Self-hosted» →
   `https://vault.peromebel.by` (все четыре поля — один и тот же адрес).
3. Войдите email'ом и мастер-паролем.
4. Дальше всё автоматически: на сайтах с сохранённым логином расширение
   предложит заполнить/сохранить пароль; новые пароли при регистрации —
   «Save login». Генератор паролей — иконка ⚡ (длина, спецсимволы).

## 3. Мобильное приложение (Bitwarden, iOS/Android)

1. Установите «Bitwarden Password Manager» из стора.
2. Настройки → «Server URL» → Self-hosted → `https://vault.peromebel.by`.
3. Логин/мастер-пароль — те же. Включите разблокировку по отпечатку/ Face ID.

## 4. Настольное приложение (опционально)

Desktop-клиент Bitwarden (Windows/Linux/Mac) — та же настройка Server URL.
Удобно для автозаполнения вне браузера.

## 5. Как организовать пароли

- **Folders (личные папки)** — для своих логинов (Работа, Банки, Личное…).
- **Organizations/Collections** — общие пароли компании (общие аккаунты
  соцсетей, панель хостера, серверы). Создаётся владельцем: «New organization»
  → приглашение сотрудников по email → общие коллекции. Участник видит только
  свою коллекцию.
- **Attachments** — к логину можно приложить файлы (рекавери-коды, ключи).

## 6. Импорт существующих паролей

Из браузера/Excel: «Tools → Import data» → источник (Chrome, Firefox,
LastPass, CSV Bitwarden…) → файл.CSV-шаблон: `folder,favorite,type,name,
login_username,login_password,login_uri,notes`.

## 7. Аварийный доступ

- Мастер-пароль хранится **у вас** (и желательно его печатная копия в сейфе).
- Экспорт всего хранилища: «Tools → Export vault» (JSON/CSV, зашифрованный
  JSON экспорт) — рекомендуется делать раз в квартал и убирать в надёжное место.
- Утеря мастер-пароля: восстановление невозможно; если вы участник
  organization, администратор может пересоздать вам аккаунт и вы снова
  получите доступ к общим коллекциям (личные папки — нет).

## Для администратора

- **Админ-панель**: `https://vault.peromebel.by/admin` — токен у владельца
  (файл учётных записей). Диагностика, пользователи, отключение регистрации.
- **Отключить свободную регистрацию** после онбординга сотрудников:
  админ-панель → General settings → `SIGNUPS_ALLOWED=false` (или правка
  `/etc/default/vaultwarden` на CT 106 + `docker restart vaultwarden`).
- Сервер: CT 106 `vaultwarden` (192.168.0.36), данные `/srv/vault`
  (zdata/vault, шифровано), docker-контейнер `vaultwarden`, конфиг
  `/etc/default/vaultwarden`. Обновление образа:
  `ssh root@192.168.0.36 "docker pull vaultwarden/server:latest && docker rm -f vaultwarden && docker run -d --name vaultwarden --restart unless-stopped -p 80:80 -v /srv/vault:/data --env-file /etc/default/vaultwarden vaultwarden/server:latest"`.
- Резервная копия: ежедневно в restic (`vault.tar.gz`, данные + БД).
- Kuma-монитор: `https://vault.peromebel.by/alive`.
