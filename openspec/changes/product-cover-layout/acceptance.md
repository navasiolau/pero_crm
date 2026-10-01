# Приёмка product-cover-layout

## Локальная приёмка

Root проверил существующие данные и обложки через CUA на 1920×1080, 1440×900, 390×844 и 360×800. На desktop обложка занимает правую колонку 630×952 px и начинается на y=80, на одной линии с заголовком; левая область остаётся около 60%. Без обложки сведения занимают всю ширину и показывают одну иконку добавления. Изображение без описания сохраняет большую область обложки. Портретные и альбомные изображения не обрезаются.

Полноэкранная обложка занимает viewport. На странице изделия показаны только две иконки обложки; на досках проверялись загрузка preview и layout, без проверки иконок. Engineer на своём DESIGN видит техническое редактирование и может открыть/закрыть picker; файлы не выбирались. Чистые WORKER/MOUNTER не получают доступ к DESIGN изделию. Оригинал используется в fullscreen или при явном скачивании файла.

Измеренный preview cover: 62,490 B, 674×978 px, против original 773,326 B. Board card preview: 23,448 B, 331×480 px. Это размеры проверенных ответов, не измерение задержки загрузки. При условном запросе manager получил пустой `304`; worker с тем же прогретым ETag получил `404` без ETag.

Полный suite — 525/525, focused cover/hero — 20/20, backend — 14/14 (повтор root), TypeScript, production build и строгая OpenSpec-проверка прошли. Lint: ноль ошибок и одно существующее предупреждение `existsSync` в `apps/web/scripts/cleanup-uploads.ts`.

В local при навигации появилась одна существующая `products.list` preference. Root восстановил её предыдущее значение CAS-проверкой. Итоговый local preservation evidence показал совпадение schema/ledger, 42 таблиц и metadata inventory 4,726 uploads по size/mtime; `changedTables=[]`. Полное содержимое всех upload-объектов не перечитывалось и не перехешировалось.

## Staging

Коммит `a899e8e` развёрнут на staging; runtime был проверен как healthy. Root выполнил CUA на 1920×1080, 1440×900, 390×844 и 360×800. Desktop/mobile расположение соответствует локальной проверке; fullscreen на 360×800 заполняет viewport. Engineer на своём DESIGN открыл и отменил picker; существующие изображения не выбирались. Kanban использует lazy card WebP. QA-записи/файлы не создавались, обложки, статусы и финансовые данные не менялись.

Первоначальная read-only диагностика `54d6458a-4c0a-40f1-ada6-81b8178b9cc5` показала одно отличие от baseline: `ApiToken.lastUsedAt`. Строгая проверка AFTER остановилась на drift. Финальное доказательство квалифицировало тот же captured diagnostic snapshot: новый DB/S3 snapshot не создавался, исправлений или восстановления не выполнялось. Оно подтвердило монотонность timestamp и точное совпадение остальных полей этой записи и трёх проверенных ID. В остальных 41 бизнес-таблицах, схеме и ledger различий не найдено; metadata 4,738 S3 object versions совпадает по key/version/ETag/size. ChangeLog, Notification и preferences неизменны. Receipt не утверждает побайтовую идентичность содержимого всех S3-объектов; upload/S3 content не перечитывался целиком.

Qualified staging read-only UI/preservation acceptance завершена с указанным исключением для timestamp `ApiToken.lastUsedAt`. Proof attempt `d70cc541-8f08-4b9e-abe4-dcd9389896aa` сохранён в [`deploy/evidence/product-cover-layout-staging-20261001.json`](../../../deploy/evidence/product-cover-layout-staging-20261001.json); он относится к baseline run `798eae1a-503e-4f80-aa07-e533dfe20640` и receipt SHA `c0418204aa0c495817f86d17a1f503ad2d92d7e1b597b3d6bed8669f8c379383`. В доказательстве есть `1` существующий config и `2` участника от другой существующей ADMIN-операции, при `earnedCompletions=0`, `completionShares=0` и `directPayroll=0`; эти строки не созданы QA и не являются приёмочным начислением этой функции.

Прямая запись cover pointer, upload и реальная замена изображения намеренно не тестировались: проверка использовала только уже существующие записи и не отправляла мутации.

## Границы проверки

Live cover replacement/upload не проверены ни на local, ни на staging. Размеры preview отражают только конкретные ответы; latency/load performance не измерялась. Изменения main/production не выполнялись и остаются HOLD.
