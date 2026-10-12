# Spec Delta

## Purpose

Обеспечить загрузку обычных вложений без роста транспортной памяти пропорционально файлу, сохраняя оригинальные байты, ролевые ограничения, подтверждённые повторы и действующие web-сценарии.

## ADDED Requirements

### Requirement: Ограниченная транспортная память и размеры

Система SHALL принимать документ потоково с транспортным буфером не более32 МиБ на одну загрузку при входе25/100/1024 МиБ и сохранять предел25 МиБ для изображения и1 ГиБ для документа. Декодирование изображения SHALL учитываться отдельно. Общие body bytes, число файлов/частей/полей и размеры метаданных MUST иметь конечные пределы; превышение SHALL прекращать дальнейшее чтение без publication.

#### Scenario: Большой chunked документ
- **WHEN** разрешённый документ1024 МиБ поступает порциями без Content-Length
- **THEN** SHA256/размер совпадают с исходным потоком, транспорт остаётся bounded и не создаёт полный document buffer

#### Scenario: Точная граница и превышение
- **WHEN** поступает файл на самом разрешённом пределе и на один байт больше
- **THEN** точный предел допустим, превышение отклоняется без File/receipt и дальнейшего чтения

#### Scenario: Дополнительные части
- **WHEN** форма содержит второй файл, дубликат критического поля или превышает допустимые metadata/part bounds
- **THEN** запрос отклоняется без publication и очищает только свой временный объект

#### Scenario: Включённые границы метаданных
- **WHEN** multipart содержит поле4096 UTF8 bytes, ровно16 text fields и17 частей включая единственный file, а соседние запросы превышают любую из этих границ
- **THEN** точные допустимые значения принимаются, превышения отклоняются без publication; поле с именем длиннее100 UTF8 bytes также отклоняется независимо от parser fieldNameSize

### Requirement: Авторизация declared и legacy потоков

Система MUST проверять текущую сессию/global upload role до body в обоих потоках. При наличии declared context точный entity/mode ACL SHALL проверяться до body read; поздние multipart fields MUST совпасть с объявленным контекстом. Headerless/file-first формы SHALL оставаться допустимыми через bounded private spool: entity ACL проверяется как только известен полный контекст и повторно перед storage/finalization. Для legacy MUST NOT заявляться exact entity ACL до bytes. До ACL MUST NOT появляться business storage/DB publication.

#### Scenario: Запрещённая роль
- **WHEN** анонимный или financial-only пользователь отправляет любую форму
- **THEN** body не читается и временные/business объекты не создаются

#### Scenario: Недоступный declared target
- **WHEN** early context указывает чужую сущность или запрещённый cover режим
- **THEN** сервер отказывает до body read и storage

#### Scenario: Сохраняемый старый file-first caller
- **WHEN** разрешённый caller без early header передаёт file до projectId
- **THEN** запрос выполняется с прежним nonce/result/bytes через bounded private spool и точный ACL перед publication

#### Scenario: Подмена late target
- **WHEN** multipart project/product/task/mode/nonce отличаются от early context
- **THEN** запрос отклоняется и не публикуется ни в объявленный, ни в подменённый target

### Requirement: Повторная проверка актуального контекста

Система SHALL повторно проверять session/roles и действующие project/product/task/cover permissions перед storage и транзакционной финализацией. CAS pointers и task-product-project соответствие MUST сохраняться; просмотр собственного PRODUCTION MUST NOT добавлять техническую загрузку.

#### Scenario: Назначение или этап изменился во время передачи
- **WHEN** доступ к объявленному target утрачен либо cover baseline изменился до финализации
- **THEN** File/receipt не создаются, winning/current pointer и чужие ключи сохраняются

### Requirement: Оригинал и подтверждённая запись

Система SHALL сохранять original bytes, filename/MIME, existing keys, SHA256/fingerprint и storage-confirmation-before-File+receipt. Document transport MUST NOT перекодировать содержимое. Сохранённые File и audit/receipt SHALL быть атомарными.

#### Scenario: Документ, кириллическое имя и пустой допустимый файл
- **WHEN** разрешённый caller загружает документ с русским именем либо допустимый пустой document
- **THEN** исходные имя/байты/MIME/хеш и download сохраняются без mojibake или перепаковки

#### Scenario: Storage не подтверждён или audit отказал
- **WHEN** хранение не получило подтверждение либо audit transaction завершается ошибкой
- **THEN** успешный File/receipt не появляются, known noncommitted cleanup касается только fresh owned keys

### Requirement: Abort и неопределённый исход

Abort/лимит/ошибка SHALL останавливать новые действия и освобождать точно свой private spool. Unknown storage/DB ACK MUST NOT трактоваться как подтверждённый rollback или основание удалить возможно committed original. Состояние ответа и повтор SHALL сохранять существующий committed/notCommitted/unknown contract.

#### Scenario: Abort до публикации
- **WHEN** клиент прекращает передачу до storage/commit
- **THEN** нет File/receipt/business object, body прекращается и own temporary handles/files освобождаются

#### Scenario: Ответ commit потерян
- **WHEN** transaction могла завершиться, а ACK неизвестен
- **THEN** возможный committed original сохраняется, повтор того же намерения разрешает исход без двойной записи

### Requirement: Совместимость повторов и пользовательских сценариев

Система SHALL сохранять public helper/result contract, UUID намерения, expected cover CAS, ordinary/project-cover/sketch/measurement/batch workflows и visual layout. Один UUID+тот же нормализованный target/bytes SHALL возвращать тот же file ID; изменённое намерение SHALL конфликтовать. Права, notifications и winning/current файлы MUST сохраняться.

#### Scenario: Конкурентный и последовательный retry
- **WHEN** одинаковый запрос приходит одновременно или после потери ответа
- **THEN** существует один File/receipt/notification и сохраняются прежние успешные responses; конкурентные fresh temporary storage objects допустимы, но после подтверждённой компенсации проигравшего дополнительный owned object не остаётся. Unknown cleanup outcome не выдаётся за подтверждённое отсутствие объекта

#### Scenario: Работа через интерфейс и старое окно
- **WHEN** сотрудник выбирает файл/камеру/пачку или отправляет сохранившуюся headerless форму
- **THEN** поддерживаемая операция остаётся доступной; UI/подписи/ошибки/адаптивное поведение не меняются ради транспорта
### Requirement: Native metadata и decoded original contract

Система SHALL сохранять native File.name/type normalization, MIME parameters и последний Content-Type. Bounded native metadata parsing MUST использовать только captured заголовки и пустое тело, никогда original file stream. Part identity MUST оставаться связанной с public parser event; duplicate/ambiguous Content-Disposition SHALL отказываться без guessing/publication.

#### Scenario: Native quote/path/MIME receipt
- **WHEN** приходит прежний nonce с folder/percent-escaped quote filename и MIME parameters, сохранившимися в old native receipt
- **THEN** native filename/type/hash совпадают, old file ID возвращается без нового Put/notification

#### Scenario: Прежний native base64 original
- **WHEN** exact Content-Transfer-Encoding base64 передаёт original с обычным76char CRLF wrapping, padding/whitespace/finalpartial
- **THEN** decoded bytes/size/SHA соответствуют прежнему native File; original caps25MiB/1GiB проверяются послеdecode, finite encoded wire allowance2×decodedcap+128KiB квалифицирован отдельно
