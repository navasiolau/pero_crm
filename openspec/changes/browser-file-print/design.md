# Design

## Context

Контракт вложения уже существует: ViewableFile {id,fileName,mimeType,source?}. getViewableFileSource выбирает защищённые /api/files/:id или /api/finance/documents/:id. PDF inline включается ?view=1; финансовый route имеет CSP sandbox. Мотивация и форматы — в proposal.md. Подключение общей строки зависит от принятых задач 113 и 115.

## Goals / Non-Goals

**Goals:** стандартный браузерный print выбранного документа, проверка ответа до печати, единственный временный контекст, полное изображение без CRM.

**Non-Goals:** server/schema/API ACL изменения, новые пакеты, конвертация Word/CAD, private Chromium messaging, физическая отправка на принтер при QA.

## Decisions

- Новый helper принимает только ViewableFile; произвольный URL не принимает. Получает оригинал с credentials same-origin, cache no-store и запретом redirect; проверяет HTTP статус, MIME, непустые байты и сигнатуру PDF. PDF запрашивает существующий ?view=1.
- Печать идёт из локального blob, созданного только после успешной проверки защищённого ответа. Прямая печать финансового iframe могла бы нарушить browser sandbox; заголовки сервера сохраняются.
- Для PDF отдельный iframe загружается как application/pdf, проверяются URL и contentType, затем вызывается его штатный print(). Задержка по таймеру и внутренний Chromium protocol для готовности не используются. Browser API сам завершает загрузку перед native печатью.
- Для изображения iframe содержит только img оригинала и локальные print CSS. После decode/natural size изображение вписывается целиком на A4 с ориентацией по пропорциям, object-fit contain. Название задаётся textContent, SVG используется только как img, ни один файл не интерпретируется как HTML.
- Общий guard блокирует повторную подготовку. Подготовка ограничена 60 сек.; кнопка занята только до передачи browser print. После асинхронного PDF print iframe/blob сохраняются до afterprint, pagehide, отмены, следующей печати или двухминутной очистки. Следующая печать сначала убирает старый контекст; одновременно максимум один iframe.
- Новый FilePrintButton отображается только для поддерживаемых MIME, останавливает событие строки, показывает состояние подготовки и ошибку через существующий toast. В Phase A — новые модули и tests; существующий общий FileList задачи 115 подключается только в Phase B оркестратором после согласования истории.

## Risks / Trade-offs

- [Chromium PDF print возвращается асинхронно без внешнего afterprint] → не считать return завершением физической печати; сохранить ресурсы с ограниченным временем, штатный preview блокирует клики в CRM. Таймаут очистки не является доказательством печати.
- [Отозванный доступ или ответ страницы входа] → проверка защищённого fetch и типа/сигнатуры до создания печатного контекста.
- [Различия browser PDF support] → browser native PDF enabled проверяется; реальное Chromium preview принимается отдельно от spy/headless тестов. При недоступном PDF-контексте вывести ошибку, не печатать заглушку.
- [Большой PDF занимает память] → один blob, ограниченное время подготовки/хранения и revocation в едином cleanup.

## Migration Plan

Без миграции БД и дампов. Local проверки новых модулей, независимое ревью, затем подключение на принятом staging после задачи 115. Commit и merge/push staging только по прямому разрешению владельца. Production и инфраструктура вне задачи.

## Sources

- [MDN Window.print](https://developer.mozilla.org/en-US/docs/Web/API/Window/print): print открывает диалог текущего документа и ожидает завершения его загрузки.
- [MDN afterprint](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event): событие связано с началом печати или закрытием preview.
- [Chromium PDF scripting source](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/resources/pdf/pdf_scripting_api.ts): readiness и внутренний print протокол изучены, private API в продукт не переносится.
