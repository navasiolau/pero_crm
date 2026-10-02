# Spec Delta

## Purpose

Предоставить рабочие inline-блоки замеров и документов изделия без потери прежних вложений и расширения файловых прав, с корректной компоновкой по ширине рабочего контейнера.

## ADDED Requirements

### Requirement: Замер под описанием

Система SHALL отображать самостоятельную галерею замера непосредственно под техническим описанием: загрузка фото, thumbnails и полноэкранный просмотр. Все существующие файлы category MEASUREMENT SHALL попадать сюда независимо от прежнего stage и выбранной обложки: measurement priority побеждает cover исключение. Существующие не-image файлы замера SHALL сохранять поддерживаемый просмотр/скачивание; переход к галерее SHALL не удалять/конвертировать их.

#### Scenario: Замер выбран обложкой
- **WHEN** существующий MEASUREMENT image этого изделия выбран sketchFileId
- **THEN** он остаётся в галерее замера с тем же ID/metadata/key; исключение обычного PHOTO-cover из Production/Installation не удаляет measurement presentation

#### Scenario: Старый замер другого этапа
- **WHEN** изделие имеет MEASUREMENT PDF со stage INSTALLATION и новый image замер
- **THEN** оба видны в замере, фото открывается fullscreen, PDF сохраняет доступный просмотр/скачивание; stage/category/ID прежнего PDF не меняются

### Requirement: Документы на всю рабочую ширину

Система SHALL отображать «Производство» и «Монтаж» как самостоятельный полный по ширине блок после основных реквизитов. При рабочей ширине контейнера не меньше 640px SHALL быть две равные колонки с промежутком, а ниже 640px — сначала Production затем Installation, каждая на всю ширину. Длинные file names/gallery/actions SHALL не вызывать горизонтального выхода всей страницы.

#### Scenario: Sidebar меняет доступное место
- **WHEN** desktop viewport сохраняется, а sidebar уменьшает рабочий контейнер ниже 640px
- **THEN** документы перестраиваются в последовательные полноширинные блоки, не остаются двумя узкими колонками по viewport breakpoint

### Requirement: Сохранная классификация и реальные операции

Система SHALL отображать не-MEASUREMENT файлы PRODUCTION/ASSEMBLY в Production, INSTALLATION — в Installation. Новые операции SHALL использовать реальное existing файловое хранилище и server actions/routes; новый upload SHALL сохранять правильную product/project привязку и существующие категории/этапы. Прежние IDs/keys/storedNames/metadata/bytes SHALL не переписываться ради нового layout. Успех SHALL подтверждаться сервером; ошибка SHALL не создавать неподтверждённую галерею или удалять прочие файлы.

#### Scenario: Старые assembly документы
- **WHEN** изделие содержит assembly drawing, production PDF и installation image
- **THEN** первые два показаны в Production, третий в Installation, все прежние storage keys/category/stage сохраняются

#### Scenario: Ошибка загрузки/удаления
- **WHEN** upload/delete получает отказ
- **THEN** прежние confirmed файлы/поля остаются, ошибка видна; retry не перезаписывает старое вложение и delete не касается другого ID

### Requirement: Одинаковые файловые права

Система SHALL сохранять existing actor visibility/upload/delete policy для original/thumbnail/fullscreen/download и непосредственных URLs. Актуальный доступ SHALL проверяться перед storage операцией; старый запрос инженера после выхода изделия из разрешённого DESIGN SHALL не обходить policy. Совмещённые роли SHALL сохранять объединение, readonly просмотр SHALL не давать новый write. Delete SHALL требовать явное подтверждение точного fileId.

#### Scenario: Прямой URL и старая форма
- **WHEN** ограниченный инженер читает чужой оригинал/превью либо отправляет upload/delete из старой формы после смены статуса
- **THEN** сервер отказывает до storage доступа/записи, скрытые файлы не раскрываются

### Requirement: B3D и состояние карточки

Менеджерская отметка «Модели нет» SHALL находиться в Production и использовать действующий профильный setter/права. Новая раскладка SHALL сохранять правило передачи инженером: B3D этого изделия либо подтверждённая отметка. Файловые обновления SHALL сохранять pending/dirty description/другие inline черновики и их raw CAS baselines; они SHALL не копировать документы в Product.description или менять price/status/pay/initial snapshots.

#### Scenario: Модель и черновик
- **WHEN** инженер загружает B3D при несохранённом description, либо менеджер ставит «Модели нет»
- **THEN** availability перехода обновляется только после server confirmation, raw draft не теряется и финансовый переход не обходит незавершённые необходимые операции

### Requirement: Независимая приёмка №20

Задача SHALL самостоятельно пройти classification/rights/error tests и реальную upload/view/download/delete приёмку точных local/staging ревизий. Проверки SHALL включать plugin on/off, старые metadata/keys, mixed image/nonimage, рабочую ширину640, шесть размеров и actual200% zoom. Build SHALL не заменять gallery/runtime/storage proof; финальная single-page №25 SHALL не быть условием работоспособности.

#### Scenario: Повтор PDF и изображений
- **WHEN** разрешённый пользователь добавляет два документа/фото, просматривает и подтверждает удаление одного
- **THEN** все реальные операции работают на отдельной №20 ревизии; второй файл и прежние данные сохранны, точный original/thumb key удалённого own file проверен, сторонние ключи не затронуты
