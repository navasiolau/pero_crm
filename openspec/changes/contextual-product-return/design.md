# Design
## Context
Global lists уже используют normalized URL/CAS UserPreference. ProjectTabs default overview без URL. ProductHeader получает parent backHref и удаление отдельно push parent.
## Goals / Non-Goals
Возврат в точный global view/filter/sort/page или Project products. Не менять card cover behavior52, права, данные и financial rules.
## Decisions
Helper строит Product URL с URLSearchParams returnTo. Сервер допускает только literal /products с нормализованными query и actual parent /projects/<encodedId>?tab=products. Никакого referrer/router.back и внешних origin; malformed/array/hash/backslash/controlchars/другой Project → parent products fallback. Ограничить length4096.
Project принимает whitelisted tab среди реально доступных basic/plugin tabs; неизвестный/array → overview. URL tab задаёт defaultValue, обычный выбор tabs остаётся существующим без preference writes. Global links используют snapshot canonicalquery из useListParams, возвращение одинаково для mobile link/table row/kanban row и ProjectProducts row. Back aria label зависит от разрешённого назначения, deletion-success использует тот же validatedHref.
## Risks / Trade-offs
Dirty filter debounce при открытии использует последнюю каноническую query, не несохранённый ввод. URL не является ACL: actual Product/project auth остаются прежними. Прямая ссылка fallback parent/products.
## Migration Plan
Нет миграций; root local checks, ordinary integration и actual staging. Навигацию обновлять единым атомарным change51; cover52 отдельно.
