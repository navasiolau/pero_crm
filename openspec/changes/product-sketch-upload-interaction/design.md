# Design

## Context

PhotoUploadButton уже не отправляет caption. Sketch POST требует PHOTO/assignCover1/expectedSketchFileId:null/UUID и проверяет согласованный sketch ACK. Подтверждён отдельный pre-POST дефект: direct crypto.randomUUID() throws при отсутствии secure-context API. Actual component handler test воспроизвёл отсутствие метода; existing createRequestId использует strong getRandomValues fallback. Точный origin пользователя/root runtime пока не подтверждён. Пустая область сейчас не выбирает файлы, camera/описание общие для всех contexts, delete X, cover sticky.

## Goals / Non-Goals

**Goals:** sketch-context interaction без изменения backend grants/byte semantics.
**Non-Goals:** header/quantity41, thumbnail engine44/global dialog45, новые форматы/MIME defaults, original data/финансовые writes.

## Decisions

1. Sketch-only coverSurface prop использует тот же uploader и original File. Отдельный always-mounted hidden input нужен потому, что modal input отсутствует в DOM при закрытом dialog; выбор в области не должен зависеть от открытия modal.
2. Только assignCover context скрывает camera/описание и меняет кнопку. Generic/task measurement capture сохраняется.
3. Pure multipart helper валидирует текущий MIME/size/nonce и не трансформирует File; tests проверяют bytes и отсутствие caption. Critical flush tests включают clean/nullable/read-only и genuine dirty failure.
4. Sketch upload/delete используют existing createRequestId (strong UUIDv4 fallback, без Math.random). ACK/CAS/retry прежние; видимый alert и для direct area. Удалить только lg:sticky/lg:top-20, сохранив viewport height/grid.

## Risks / Trade-offs

- [Клик hidden input всплывает] → input/button stopPropagation; region keyboard только currentTarget.
- [Сетевая неопределённость] → прежний UUID/retry; never optimistic cover clearing.

## Migration Plan

Нет миграции. Root воспроизводит reported failure и выполняет runtime/visual после local checks. Статический успешный contract не выдаётся за доказанный runtime fix.
