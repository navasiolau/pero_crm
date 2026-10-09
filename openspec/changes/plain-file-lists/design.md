# Design

## Context

См. proposal.md. Обычные списки сейчас используют FileGridView с миниатюрами/метаданными; финансовые документы имеют отдельный защищённый source. Текущий FileViewer умеет изображения целиком, но для PDF/видео имеет дополнительные сценарии. Серверный mayDeleteStoredFile сохраняет собственный файл либо менеджерское право; финансовые привязки не разрешают удалять документ отдельно от операции.

## Goals / Non-Goals

**Goals:** один независимый файловый ряд и компактное подтверждение, затем подключение всех существующих списков на reviewed dependency 113 с deployment gate её staging-приёмки.

**Non-Goals:** печать задачи 116, изменение финансовых операций/ACL, схема аудита, новые просмотрщики и произвольные URL источников.

## Decisions

- FileListItem расширяет существующий ViewableFile только признаком canDelete. Файловые строки получают onDelete с текущей формой результата {ok,error?}, onDeleted для обновления вызывающего списка и onBusyChange там, где загрузка/удаление блокируют закрытие формы.
- Изображение — текстовая кнопка с existing image viewer; non-image — текстовая ссылка с download и известным getViewableFileSource. Это сохраняет оригинальное имя, финансовый маршрут и не открывает PDF/video viewer. Строка гасит click/keyboard propagation.
- FileDeletePopover использует нынешний Base UI Popover, фокус на отмене, предупреждение и две кнопки. Controlled open и немедленный ref-lock предотвращают двойной запрос и закрытие pending; ошибка остаётся внутри. FileList блокирует конкурирующие удаления одного списка до результата.
- Новый компонент не отображает переданные лишние метаданные. Имена переносятся полностью, без truncate; мобильная зона урны сохраняет 44px при маленьком значке.
- Phase A: только новые компоненты, тесты и этот OpenSpec. Phase B: ordinary merge origin/staging и reviewed origin/feature/113 в feature/115; adapters используют File.section GENERAL/MEASUREMENT/PRODUCTION/INSTALLATION и общий компонент. Deploy 115 остаётся строго после actual staging acceptance 113. Копирование файлов, cherry-pick и squash не применяются.
- Permission adapters вычисляют canDelete через существующие серверные правила, не доверяют клиенту и сохраняют uploadedById для аудита/авторизации. Display-only запросы авторов удаляются после проверки использования. Financial document adapters не меняют payment/reportDocument связи. FinanceDocument service имеет upload/read/list и не имеет отдельного delete API: все finance урны, включая unlinked selected upload, неактивны без новых разрешений.
- Альтернатива отдельным универсальным URL и viewer-dispatch hooks не нужна: существующего ViewableFile source и браузерного download достаточно.

## Risks / Trade-offs

- Связанная финансовая строка может реагировать на файловый клик → browser tests проверяют click и keyboard propagation.
- Быстрый повтор, закрытие окна или отказ сервера → ref-lock, controlled popover, ошибка без удаления строки и refresh только по успеху.
- Старый canEdit ошибочно разрешает чужой файл → серверные per-file flags и повторная проверка действующей action.

## Migration Plan

Новых миграций нет. Source 115 интегрирует reviewed113 обычным merge в рабочей ветке; actual staging acceptance113 остаётся обязательной до normal merge/deploy115. Затем CI и проверка фактически развёрнутого staging. Production и restic не затрагиваются.
## Уточнение layout от 09.10.2026

- Общий FileGroupPanel задаёт видимую рамку, единую строку header и вертикальный body. Header содержит название с «(количеством)» слева и существующий upload-control справа; body содержит FileGridView/FileList целиком внутри рамки.
- Uploader сохраняет обработчики и параметры загрузки. Header/children позволяют обрамлять группу, включая пользователя без upload-права: заголовок и файлы остаются видны, control отсутствует.
- ProductMeasurement, ProductDocuments и существующие project/product FilesTab используют одну панель. При ширине 1440/390/360 panel и её содержимое не создают горизонтального переполнения; названия файлов продолжают переноситься в одной колонке.
- FileListRow, кнопки печати/удаления, маршруты и ACL не меняются. Историческая приёмка сохранена; новая проверка измеряет только расположение рамки, header и строк.
