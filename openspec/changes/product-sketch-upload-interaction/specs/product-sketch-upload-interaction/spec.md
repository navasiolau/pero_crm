# Spec Delta

## Purpose

Загрузка эскиза доступна через пустую область и понятный dialog без изменения исходного файла, текущего указателя и действующих защит доступа.

## ADDED Requirements

### Requirement: Пустой эскиз принимает выбор и drag/drop

Пустая область SHALL целиком открывать выбор изображения кликом/клавиатурой и принимать image drag/drop. Крупная кнопка SHALL иметь чёрный фон/белый текст и открывать sketch dialog без «Снять фото» и удалённой описательной фразы. Общие photo/task capture controls MUST сохраняться.

#### Scenario: Выбор в пустой области
- **WHEN** пользователь кликает пустую область, выбирает файл или drops изображение
- **THEN** используется тот же original File и существующий guarded upload path

### Requirement: Подтверждённая безопасная операция

Uploader SHALL сохранять original bytes/MIME/name, CAS empty pointer, UUID/replay и ограничения MIME/size/ACL. Только согласованный ACK SHALL менять отображение; ошибка SHALL быть видима, существующий эскиз MUST не очищаться. Clean/readonly/nullable critical baselines SHALL не вызывать новые scalar writes. Причина runtime отказа SHALL подтверждаться реальным request/error, без выдуманных defaults.

#### Scenario: Ошибка
- **WHEN** upload отказан или ACK неоднозначен
- **THEN** ошибка видима, подтверждённый эскиз сохранён, retry сохраняет первоначальный UUID

### Requirement: Эскиз остаётся в потоке документа

Cover SHALL не следовать за scrolling. Удаление SHALL обозначаться красной корзиной с существующим confirmation/CAS.

#### Scenario: Прокрутка и удаление
- **WHEN** карточка прокручивается либо выбирается удаление
- **THEN** cover не sticky; красная корзина открывает прежнее confirmation и точный delete
