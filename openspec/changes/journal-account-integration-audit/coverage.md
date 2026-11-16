# Покрытие №228

Проверены действующие server actions, связанные transaction cores, Auth.js configuration/events, публичные bot/plugin routes, startup registry sync и DB-trigger отзыва credentials. Матрица относится к текущему зарегистрированному коду; будущие команды модулей требуют собственной проверки границы выполнения.

| Операция / вход | Событие и исполнитель | Полные данные и проверка |
|---|---|---|
| Users: create/update | `user/create`, `user/update`, пользователь | Имя, email, должность, контакты, роли, схема/процент оплаты, активность, calendarEnabled; только flag смены пароля. User+audit в одной tx, no-op без события. `journal-account-core`, `calendar-user-actions`, native helper |
| Users: revokeUserSessions | `user/revokeSessions`, пользователь | Прежняя и новая версия сеансов, полный safe user snapshot; одна tx |
| Следствия DB trigger | `user/revokeSessions`, `apiToken/revoke`, Система + инициатор | Фактически изменившаяся sessionVersion и реально отозванные персональные API-токены; старые токены заблокированы/прочитаны до update. Trigger и его правила не меняются. `journal-account-core`, native helper |
| Credentials sign-in | `user/login`, пользователь | Только подтверждённый non-null результат прежнего JWT callback, затем Auth.js signIn event. Ephemeral UUID не попадает в JWT/session/client. `journal-auth-events`, `journal-auth-wiring` |
| Явный sign-out | `user/logout`, пользователь | Устойчивый ключ JWT jti без записи JWT; повтор одного события не дублируется. Actual Auth.js signOut cookie cleanup проверен при отказе callback |
| Telegram web request | `telegramLink/link.request`, пользователь | Состояние привязки и срок запроса без одноразового кода; одна tx |
| Telegram bot API link | `telegramLink/link`, linked user, источник Telegram | Состояние до/после, username/chatId/время; прежние expiry/occupied/inactive guards. API scope write сохранён. `journal-telegram`, existing CI HTTP integration |
| Telegram self/admin unlink; bot API unlink | `telegramLink/unlink`, реальный пользователь | Полный safe снимок удаляемой привязки; чужая web-привязка требует прежнего admin grant. Повтор удаления отсутствующей привязки без события |
| Bot register | `orgSetting/update`, Система | Изменение зарегистрированного username, без события при прежнем значении; advisory lock покрывает первое создание. `journal-telegram` |
| Plugin toggle | `plugin/toggle`, пользователь | Реальное прежнее enabled вместо выдуманного `!enabled`; событие и outbox в tx; lifecycle после commit. `journal-plugin-settings` |
| Plugin settings | `plugin/update`, пользователь | Только разрешённые keys; полные safe before/after, labels/options из manifest, явные overrides; секреты скрыты также в raw audit. Все upserts и audit одной tx |
| Plugin metadata startup | `plugin/create|update`, Система | Версия, описание, API version, permissions и имя; неизменный restart без audit. `plugin-sync-noop`, transaction wrapper |
| Plugin lifecycle/context audit | Исходный код плагина; Система + известный инициатор | Исходные actor/plugin факты сохранены, source plugin. Explicit emitter и hook delivery contract сохранены. `plugin-context-events` |
| Web demo.ping | Plugin effect + `plugin/command` пользователя | Проверенная DB-only команда demo 0.1.0/api1: db/audit/outbox одной tx; dispatch/log после commit. Непроверенная будущая команда не запускается внутри tx. `journal-plugin-command`, `journal-actions-boundaries` |
| API demo.ping | Plugin effect + `plugin/command`; token owner либо Система | Сохраняется write/admin scope grant, включая активного owner MANAGER; повторная проверка token/revocation/scopes/owner. Ownerless service key — Система. Safe token ID, никогда token/hash. Existing CI HTTP integration и `journal-plugin-command` |
| API token create/revoke | `apiToken/create|revoke`, пользователь | Stable row ID вместо имени; name/prefix/scopes/owner/plugin/time/revocation, без секрета и hash. Одна tx; повтор revoke без события. `journal-plugin-settings` |
| Notification preference | `notificationPreference/update`, пользователь | Значение и факт явной настройки; прежний default/fallback учитывается. Повтор сохранённого значения без события |
| Counterparty create/update | `counterparty/create|update`, пользователь | Компания, тип, телефон, комментарий; прежние CAS/ACL и tx сохранены. Existing counterparty suite, native helper |

## Явные исключения

- CalendarEntry, calendar reminder delivery/outbox и `notificationPreference.type=plan.reminder` полностью вне журнала. Административный `User.calendarEnabled` остаётся настройкой учётной записи, без содержания личного плана.
- UserPreference/list preference, чтение страниц/поиск, notification.readAt, автоматическая доставка уведомлений, token.lastUsedAt, технические event delivery leases/attempts и PluginRunLog не становятся дополнительными бизнес-событиями.
- CLI/offline import/recovery, проекты/КП/изделия, задачи/работы/файлы и финансовые/складские writers относятся к другим задачам и не изменяются здесь.

## Исторические API-токены

Старый writer использовал `entityId=name`, поэтому это значение нельзя превращать в ссылку по ID. В №228 исправлен formatter: имя сущности `apiToken` больше не маскирует целый объект safe metadata. Scalar token и вложенные secret/code/hash по-прежнему скрываются; известный формат `pero_` + 32 base64url-символа скрывается и в свободном тексте. Ограниченный repair ранее collapsed presentations согласован с №222/root: пересборка только доказуемого дефекта из сохранённого raw, без изменения исходной истории и потери новых explicit hints.

## Подтверждённая staging-приёмка

Root принял №228 на actual `e3f99ff05b97f3999fc8fbf74472e9077d769a3b`, штатный CI43796217344 **7/7 SUCCESS**: native PostgreSQL **87/87**, target guards **13/13**, HTTP/S3 **32/32**, включая actual startup/register lock regression. Runtime web/renderer healthy, HTTP200; DB/W07 сохранены. Native account helper: happy **27 assertions / 18 events** и fault **3 assertions PASS**, `SET CONSTRAINTS ALL IMMEDIATE`, rollback, own users0 и сохранённый audit count.

Реальный browser/auth: bad password без события, ADMIN login и доступ к журналу, login/logout по одному и отсутствие событий при session refresh. WORK_COORDINATOR получил отказы трёх readers; project/product SSR ответили **302 без разметки журнала**. Разрешённая отрисовка этих карточек и статус403 этим сценарием не доказываются. Созданы ровно 4 собственных auth-события без проверяемых секретов; exact cleanup удалил 4 и подтвердил users0/events0. Ранний auth PASS и неудачный промежуточный redirect-following harness с cleanup3 сохранены раздельно в evidence.

Первый final refresh обновил **5529** представлений с сохранением raw. Readonly проверка **4** исторических apiToken записей: для **3** восстановлены сохранённые scopes с русскими подписями, **1 revoke — без snapshot**; имена исторически не сохранялись и не восстанавливались. Агрегаты: names0/scopes3/secretsChecked0/collapsedRoots0; проверка реальных старых секретов здесь не заявляется. Raw API codes сохранены. Повтор выявил1679 searchText-only обновлений из-за порядка токенов JSONB; отдельная доработка №222 требует нового CI и подтверждённого нуля обновлений. Это не меняет принятую native/auth область №228. Сохранность: 75/76 исходных таблиц совпали, отличие только в штатном ApiToken.lastUsedAt при стабильных остальных полях; 5529 ChangeLog raw hash сохранён. Точные image digests и пути receipts приведены в evidence.md.
