# Design

## Context

ProjectPage уже проверяет доступ к проекту и формирует allowlist начальной вкладки; ProductPage остаётся одной длинной страницей через ProductSinglePage. №222 обеспечивает строгий ADMIN reader и точные контексты, №223 — общий Journal. Base UI Tabs.Panel по умолчанию не монтирует скрытое содержимое.

## Goals / Non-Goals

**Goals:** два небольших server-side подключения общего UI, отложенное чтение и неизменные текущие формы/навигация.

**Non-Goals:** менять доменную принадлежность событий, добавлять новые права или новые продуктовые вкладки, менять данные или writers.

## Decisions

- На обеих server pages используется `hasAnyRole(role, ["ADMIN"])`; ADMIN_ROLES/requireAdmin здесь неприменимы, поскольку включают DIRECTOR. Только при этом флаге создаются trigger/content или нижняя секция.
- ProjectPage добавляет journal после plugin IDs в allowlist resolveProjectTab и последним trigger/content. EntityJournal лежит внутри обычного TabsContent с keepMounted=false: скрытая вкладка не монтирует Journal.
- ProductSinglePage получает необязательный ReactNode journal, отображаемый последним разделом только при наличии. Остальные переданные блоки и их последовательность не меняются. ProductPage передаёт его только ADMIN.
- EntityJournal принимает точный scope (project/product, id) и режим `whenVisible`; изделие включает IntersectionObserver с нулевым rootMargin. После первого пересечения observer отключается, Journal остаётся смонтированным. SSR до пересечения содержит только placeholder. При отсутствии IntersectionObserver есть явная кнопка загрузки; никакого фонового чтения при открытии страницы.
- scope строится из `project.id`/`product.id` результата существующей защищённой загрузки, не из params.id. Права reader проверяются повторно №222.
- Серверные тесты исполняют реальные Page функции с подменой внешних reader/тяжёлых чужих компонентов. Браузер проверяет реальные Tabs/ProductSinglePage/EntityJournal и Journal №223 с read-only synthetic transport: до открытия/прокрутки запросов нет, после — один точный context.

## Risks / Trade-offs

- Непреднамеренный показ DIRECTOR через ADMIN_ROLES → явный ADMIN на страницах и ролевая матрица реального server render.
- Раннее монтирование скрытого Journal → настоящий браузерный счётчик action requests до/после открытия вкладки и intersection.
- Повторное использование номера → передача постоянного ID из результата загрузки сущности.
- Условное наблюдение без поддержки API → явная кнопка «Загрузить журнал», а не автоматический запрос.

## Migration Plan

До local интеграционной проверки выполнить только разрешённый root штатный merge принятого staging с №223; чужие файлы не копировать. Root принимает diff, штатный CI и actual staging. Миграции и прямые записи БД отсутствуют.
