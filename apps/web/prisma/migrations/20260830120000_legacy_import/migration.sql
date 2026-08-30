-- ─────────────────────────────────────────────────────────────────────────────
-- Ф7: импорт реальных данных из legacy CRM (pero_legacy_clean) → PERO CRM v2.
--
-- Legacy база используется СТРОГО на чтение (dblink), она неприкосновенна.
-- Связи резолвятся только по ID (§17 плана).
--
-- Правила владельца:
--  1. Дубли клиентов схлопываются по нормализованному имени («ОЗОН» ×99 → 1),
--     проекты переподчиняются каноническому клиенту.
--  2. Заказы-заглушки (номер без цифр: «нет», «Гена Дрогичин») не импортируются.
--     (Архив/удалённые в clean-базе уже отсечены при её сборке — все записи
--     «активные»; здесь дополнительно отфильтровываются заглушки.)
--  3. Правило давности: проект, созданный более года назад
--     (до 2025-08-30) или без изменений более полугода (до 2026-02-28),
--     импортируется ЗАВЕРШЁННЫМ: все его изделия и задачи — DONE,
--     неконвертированные старые заявки — REFUSED.
--
-- Не импортируется (решение владельца): финансы целиком (кассы t1001, статьи
-- t310, оплаты t360, ЖДС t300, общие расходы t460), зарплата (t540/t1161/t2881)
-- и файлы финансовых документов. Экономика v2 заполняется заново.
--
-- Если legacy недоступна (например, на проде) — импорт пропускается с NOTICE,
-- кроме локального администратора, который создаётся всегда.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS dblink;

-- Безопасные касты: legacy читается текстом, мусорные значения → NULL.
CREATE OR REPLACE FUNCTION _legacy_ts(v text) RETURNS timestamp LANGUAGE plpgsql AS $fn$
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
  BEGIN
    RETURN v::timestamp;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
END $fn$;

CREATE OR REPLACE FUNCTION _legacy_num(v text) RETURNS numeric LANGUAGE plpgsql AS $fn$
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
  BEGIN
    RETURN replace(replace(btrim(v), ' ', ''), chr(160), '')::numeric;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
END $fn$;

-- Нормализация имени клиента для дедупликации: нижний регистр, без
-- пунктуации, пробелы схлопнуты. «ОЗОН», «Озон », «озон.» → «озон».
CREATE OR REPLACE FUNCTION _legacy_name(v text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN btrim(regexp_replace(lower(regexp_replace(COALESCE(v, ''), '[.,;:()«»"''-]', '', 'g')), '\s+', ' ', 'g'));
END $fn$;

-- ─── 0. Очистка тестовых/предыдущих данных (доменные таблицы целиком) ────────
TRUNCATE TABLE
  "TaskDependency", "TimeEntry", "PayrollEntry", "Payout", "Task", "Work",
  "PriceItem", "ProductStatusHistory", "ProjectStageHistory", "Product",
  "Project", "Communication", "File", "ProjectMaterial", "StockMovement",
  "Material", "MaterialCategory", "Payment", "CashAccount", "ExpenseArticle",
  "Notification", "NotificationPreference", "ChangeLog", "DomainEvent",
  "Client", "User", "UserPreference"
RESTART IDENTITY CASCADE;
-- Сохраняются: OrgSetting (payrollCurrency), Plugin, PluginSetting, ApiToken.

-- ─── 1. Локальный администратор (вне legacy-блока — создаётся всегда) ────────
INSERT INTO "User" (id, email, name, "passwordHash", role, "payScheme", active, "updatedAt")
VALUES (
  'user_admin_mikita',
  'mikita.navasiolau@gmail.com',
  'Mikita Navasiolau',
  '$argon2id$v=19$m=19456,t=2,p=1$GeV1O801gdgHwSVEBw30Jg$Go1XjP8Jy5VxucOfSfMsS7CPnkiLpXUxHoU6nnOfe6Q',
  'ADMIN'::"Role", 'NONE'::"PayScheme", true, now()
)
ON CONFLICT (email) DO NOTHING;

-- ─── 2. Импорт из legacy ─────────────────────────────────────────────────────
DO $legacy$
DECLARE
  v_has_legacy boolean := false;
  c_conn text := 'host=host.docker.internal port=5432 dbname=pero_legacy_clean user=pero password=pero_legacy_dev';
  -- Правило давности: сегодня 2026-08-30
  c_year_ago  constant timestamp := '2025-08-30';  -- создан более года назад
  c_half_ago  constant timestamp := '2026-02-28';  -- изменения более полугода назад
BEGIN
  BEGIN
    PERFORM dblink_connect('legacy', c_conn);
    v_has_legacy := true;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Legacy DB недоступна, импорт пропущен: %', SQLERRM;
  END;

  IF v_has_legacy THEN

  -- ── 2.1 Пользователи (t46 «Наши сотрудники») ──────────────────────────────
  -- Пароль у всех: pero2026 (argon2id). Роли — по решению владельца.
  INSERT INTO "User" (id, email, name, position, phone, telegram, "passwordHash",
                      role, "payScheme", active, "legacyId", "legacyTable", "createdAt", "updatedAt")
  SELECT
    'legacy_user_' || u.uid,
    CASE WHEN btrim(u.email) ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
         THEN lower(btrim(u.email))
         ELSE 'imported_' || u.uid || '@pero.local' END,
    btrim(u.fio),
    NULLIF(btrim(u.pos), ''),
    NULLIF(btrim(u.phone), ''),
    NULLIF(btrim(u.tg), ''),
    '$argon2id$v=19$m=19456,t=2,p=1$GeV1O801gdgHwSVEBw30Jg$Go1XjP8Jy5VxucOfSfMsS7CPnkiLpXUxHoU6nnOfe6Q',
    (CASE btrim(u.fio)
       WHEN 'Суботка Роман Петрович' THEN 'DIRECTOR'
       WHEN 'Гаврилюк Елена Павловна' THEN 'ACCOUNTANT'
       WHEN 'Суботка Вениамин Петрович' THEN 'MANAGER'
       WHEN 'Коробова Ксения' THEN 'MANAGER'
       WHEN 'Суботка Элла' THEN 'ENGINEER'
       WHEN 'Макаренко Алексей' THEN 'ENGINEER'
       WHEN 'Суботка Евгений Петрович' THEN 'MOUNTER'
       WHEN 'Рогозин Алексей Владимирович' THEN 'MOUNTER'
       ELSE 'WORKER'
     END)::"Role",
    'NONE'::"PayScheme",
    COALESCE(btrim(u.status) <> 'Уволен', true),
    u.uid, 't46',
    COALESCE(_legacy_ts(u.added), now()), now()
  FROM dblink('legacy', 'SELECT id::text, f483, f484, f485, f1079, f50731, f918::text, f3881 FROM t46')
    AS u(uid text, fio text, pos text, phone text, email text, tg text, added text, status text);

  -- ── 2.2 Клиенты (t320) с дедупликацией по нормализованному имени ──────────
  -- «ОЗОН» ×99, «ЯндексМаркет» ×20 → один клиент каждый. Канонической
  -- становится запись с телефоном (приоритет), при равенстве — с меньшим id.
  -- (Данные сначала в TEMP-таблицу: живёт до конца миграции, её же используют
  --  авто-клиенты ниже.)
  CREATE TEMP TABLE _c320 ON COMMIT DROP AS
  SELECT d.*,
         row_number() OVER (PARTITION BY _legacy_name(d.fio)
                            ORDER BY (COALESCE(d.phones, '') = ''), d.uid::bigint) AS dup_rn
  FROM dblink('legacy', 'SELECT id::text, f8060, f8260, f8100, f8090, f8140, f8020::text FROM t320')
    AS d(uid text, fio text, phones text, email text, addr text, contacts text, added text);

  INSERT INTO "Client" (id, name, "lastName", "middleName", phone, email, address,
                        comment, "legacyId", "legacyTable", "createdAt", "updatedAt")
  SELECT
    'legacy_client_' || c.uid,
    CASE
      WHEN COALESCE(btrim(c.fio), '') = '' THEN 'Клиент ' || c.uid
      WHEN c.words = 3 AND c.fio !~ '[0-9.]' THEN split_part(c.fio, ' ', 2)
      ELSE btrim(c.fio)
    END,
    CASE WHEN COALESCE(btrim(c.fio), '') <> '' AND c.words = 3 AND c.fio !~ '[0-9.]'
         THEN split_part(c.fio, ' ', 1) END,
    CASE WHEN COALESCE(btrim(c.fio), '') <> '' AND c.words = 3 AND c.fio !~ '[0-9.]'
         THEN split_part(c.fio, ' ', 3) END,
    COALESCE(NULLIF(btrim(c.phones), ''), NULLIF(btrim(c.contacts), ''), '—'),
    NULLIF(btrim(c.email), ''),
    NULLIF(btrim(c.addr), ''),
    CASE WHEN c.dup_rn > 1
         THEN 'Дубль клиента в v1 — объединён по имени'
         ELSE NULLIF(btrim(c.contacts), '') END,
    c.uid, 't320',
    COALESCE(_legacy_ts(c.added), now()), now()
  FROM (
    SELECT _c320.*, array_length(regexp_split_to_array(btrim(_c320.fio), '\s+'), 1) AS words
    FROM _c320
  ) c
  WHERE c.dup_rn = 1                     -- только канонические записи (дедуп по имени)
    AND _legacy_name(c.fio) <> '';       -- записи-пустышки без имени не импортируем

  -- ── 2.3 Клиенты, созданные автоматически (без карточки в v1) ──────────────
  -- Дедуп по нормализованному ИМЕНИ (не по телефону): «ОЗОН» с разными
  -- телефонами из заявок/заказов → один клиент. Авто-клиент создаётся только
  -- если имя не совпало ни с одним клиентом t320 (переподчинение ниже).
  INSERT INTO "Client" (id, name, phone, comment, "createdAt", "updatedAt")
  SELECT x.key, x.fio, COALESCE(NULLIF(x.phone, ''), '—'),
         'Создан автоматически при миграции из legacy (карточки клиента в v1 не было)',
         now(), now()
  FROM (
    SELECT DISTINCT ON (nn.nname)
      'legacy_client_auto_' || left(md5(nn.nname), 12) AS key,
      btrim(nk.fio) AS fio, btrim(nk.phone) AS phone, nn.nname
    FROM (
      -- из заказов (t181) без карты клиента
      SELECT r.fio, r.phone FROM dblink('legacy', $q$
        SELECT p.f2591 AS fio, p.f2611 AS phone
        FROM t181 p
        WHERE p.f9010 IS NULL
          AND COALESCE(btrim(p.f2591), '') <> ''
          AND p.f2651 ~ '[0-9]'
          AND NOT EXISTS (SELECT 1 FROM t241 z WHERE z.id = p.f34671 AND z.f8250 IS NOT NULL)
      $q$) AS r(fio text, phone text)
      UNION ALL
      -- из заявок (t241), которые станут лидами
      SELECT z.fio, z.phone FROM dblink('legacy', $q$
        SELECT z2.f4601 AS fio, z2.f4621 AS phone
        FROM t241 z2
        WHERE z2.f8250 IS NULL
          AND NOT EXISTS (SELECT 1 FROM t181 p WHERE p.f34671 = z2.id)
          AND COALESCE(btrim(z2.f4601), '') <> ''
      $q$) AS z(fio text, phone text)
    ) nk(fio, phone)
    CROSS JOIN LATERAL (SELECT _legacy_name(nk.fio) AS nname) nn
    WHERE nn.nname NOT IN (SELECT _legacy_name(fio) FROM _c320)
    ORDER BY nn.nname, nk.phone NULLS LAST
  ) x;

  -- ── 2.4 Заказы v1 → Проекты v2 (группа «205.21» = проект «205») ───────────
  -- Фильтр мусора: номер заказа без цифр («нет», «Гена Дрогичин») — пропуск.
  -- Правило давности: старые/неактивные группы → stage DONE.
  -- Минимальная стадия заказа — CONTRACT (заказ существует), не LEAD.
  INSERT INTO "Project" (id, number, title, stage, "stageChangedAt", currency, address,
                         "managerId", "engineerId", "clientId",
                         "legacyId", "legacyTable", "createdAt", "updatedAt")
  SELECT
    'legacy_project_' || g.grp,
    g.grp,
    COALESCE(g.addr, g.fio, 'Заказ ' || g.grp),
    (CASE
       WHEN fd.force_done THEN 'DONE'
       WHEN g.recl_open THEN 'RECLAMATION'
       WHEN _legacy_ts(g.done_date) IS NOT NULL THEN 'DONE'
       WHEN _legacy_ts(g.min_inwork) IS NOT NULL THEN 'IN_WORK'
       ELSE 'CONTRACT'
     END)::"ProjectStage",
    COALESCE(
      CASE WHEN fd.force_done THEN LEAST(_legacy_ts(g.max_touch), now()) END,
      CASE WHEN g.recl_open THEN _legacy_ts(g.recl_date) END,
      _legacy_ts(g.done_date), _legacy_ts(g.min_inwork), _legacy_ts(g.min_contract),
      _legacy_ts(g.first_added), now()),
    'BYN',
    g.addr,
    'legacy_user_' || g.manager_uid,
    'legacy_user_' || g.engineer_uid,
    CASE
      WHEN g.card_canon IS NOT NULL THEN 'legacy_client_' || g.card_canon
      WHEN g.lead_card IS NOT NULL THEN 'legacy_client_' || g.lead_card
      WHEN g.name_canon IS NOT NULL THEN 'legacy_client_' || g.name_canon
      ELSE 'legacy_client_auto_' || left(md5(_legacy_name(g.fio)), 12)
    END,
    g.grp, 't181',
    COALESCE(_legacy_ts(g.first_added), now()), now()
  FROM dblink('legacy', $q$
    WITH gr AS (
      SELECT split_part(f2651, '.', 1) AS grp,
             min(f2571) AS first_added,
             max(f26121) AS max_touch,
             min(f9900) AS min_contract,
             min(f9860) AS min_inwork,
             max(f9830) AS max_done
      FROM t181
      WHERE f2651 ~ '[0-9]'
      GROUP BY 1
    )
    SELECT gr.grp,
      (SELECT btrim(p.f2601) FROM t181 p WHERE split_part(p.f2651, '.', 1) = gr.grp
         AND COALESCE(btrim(p.f2601), '') <> '' ORDER BY p.id LIMIT 1) AS addr,
      (SELECT btrim(p.f2591) FROM t181 p WHERE split_part(p.f2651, '.', 1) = gr.grp
         AND COALESCE(btrim(p.f2591), '') <> '' ORDER BY p.id LIMIT 1) AS fio,
      (SELECT btrim(p.f2611) FROM t181 p WHERE split_part(p.f2651, '.', 1) = gr.grp
         AND COALESCE(btrim(p.f2611), '') <> '' ORDER BY p.id LIMIT 1) AS phone,
      -- карта клиента → канонический клиент (дедуп по имени, тот же порядок
      -- выбора канона, что в 2.2: с телефоном вперёд, затем меньший id;
      -- нормализация выполняется на стороне legacy — локальные функции
      -- там недоступны)
      (SELECT canon.id::text FROM t181 p
         JOIN t320 c1 ON c1.id = p.f9010,
         LATERAL (SELECT c2.id FROM t320 c2
                  WHERE lower(regexp_replace(regexp_replace(btrim(COALESCE(c2.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                      = lower(regexp_replace(regexp_replace(btrim(COALESCE(c1.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                  ORDER BY (COALESCE(c2.f8260,'') = ''), c2.id LIMIT 1) canon
       WHERE split_part(p.f2651, '.', 1) = gr.grp AND p.f9010 IS NOT NULL
       ORDER BY p.id LIMIT 1) AS card_canon,
      -- канонический клиент t320 по имени (когда карты нет, но ФИО совпадает)
      (SELECT c2.id::text FROM t320 c2
       WHERE lower(regexp_replace(regexp_replace(btrim(COALESCE(c2.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
           = lower(regexp_replace(regexp_replace(btrim(COALESCE((SELECT p.f2591 FROM t181 p
                       WHERE split_part(p.f2651, '.', 1) = gr.grp
                         AND COALESCE(btrim(p.f2591), '') <> '' ORDER BY p.id LIMIT 1), '')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
       ORDER BY (COALESCE(c2.f8260,'') = ''), c2.id LIMIT 1) AS name_canon,
      -- карта заявки → тоже через канонизацию по имени
      (SELECT canon.id::text FROM t181 p
         JOIN t241 z ON z.id = p.f34671
         JOIN t320 c1 ON c1.id = z.f8250,
         LATERAL (SELECT c2.id FROM t320 c2
                  WHERE lower(regexp_replace(regexp_replace(btrim(COALESCE(c2.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                      = lower(regexp_replace(regexp_replace(btrim(COALESCE(c1.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                  ORDER BY (COALESCE(c2.f8260,'') = ''), c2.id LIMIT 1) canon
       WHERE split_part(p.f2651, '.', 1) = gr.grp AND z.f8250 IS NOT NULL
       ORDER BY p.id LIMIT 1) AS lead_card,
      (SELECT m.id::text FROM t181 p
         JOIN t46 m ON btrim(m.f483) = btrim(p.f54651) OR m.id::text = btrim(p.f54651)
         WHERE split_part(p.f2651, '.', 1) = gr.grp ORDER BY p.id LIMIT 1) AS manager_uid,
      (SELECT m.id::text FROM t181 p
         JOIN t46 m ON btrim(m.f483) = btrim(p.f54511) OR m.id::text = btrim(p.f54511)
         WHERE split_part(p.f2651, '.', 1) = gr.grp ORDER BY p.id LIMIT 1) AS engineer_uid,
      gr.min_contract::text AS min_contract,
      gr.min_inwork::text AS min_inwork,
      gr.max_done::text AS done_date,
      gr.first_added::text AS first_added,
      gr.max_touch::text AS max_touch,
      EXISTS(SELECT 1 FROM t181 p JOIN t211 rc ON COALESCE(rc.f3441, rc.f37741) = p.id
             WHERE split_part(p.f2651, '.', 1) = gr.grp AND rc.f3581 IS NULL) AS recl_open,
      (SELECT min(rc.f3521)::text FROM t181 p JOIN t211 rc ON COALESCE(rc.f3441, rc.f37741) = p.id
             WHERE split_part(p.f2651, '.', 1) = gr.grp AND rc.f3581 IS NULL) AS recl_date
    FROM gr
  $q$) AS g(grp text, addr text, fio text, phone text,
            card_canon text, name_canon text, lead_card text, manager_uid text, engineer_uid text,
            min_contract text, min_inwork text, done_date text, first_added text,
            max_touch text, recl_open boolean, recl_date text)
  CROSS JOIN LATERAL (
    SELECT
      _legacy_ts(g.first_added) < c_year_ago
      OR _legacy_ts(g.max_touch) < c_half_ago AS force_done
  ) fd
  WHERE (g.card_canon IS NOT NULL OR g.lead_card IS NOT NULL
         OR COALESCE(btrim(g.fio), '') <> '')
    AND g.grp ~ '[0-9]';

  -- ── 2.5 Изделия (каждая запись t181 = изделие v2) ─────────────────────────
  -- Статус по датам v1; правило давности проекта перекрывает (→ DONE).
  INSERT INTO "Product" (id, "projectId", number, title, status, "statusChangedAt",
                         "expectedPrice", description, "createdById",
                         "legacyId", "legacyTable", "createdAt", "updatedAt")
  SELECT
    'legacy_product_' || p.uid,
    'legacy_project_' || split_part(p.num, '.', 1),
    p.num,
    COALESCE(NULLIF(btrim(p.kind), ''), 'Изделие ' || p.num),
    (CASE
       WHEN fd.force_done OR pr.stage = 'DONE'::"ProjectStage" THEN 'DONE'
       WHEN p.recl_open THEN 'RECLAMATION'
       WHEN _legacy_ts(p.d9) IS NOT NULL THEN 'DONE'
       WHEN _legacy_ts(p.d8) IS NOT NULL THEN 'INSTALLATION'
       WHEN _legacy_ts(p.d6) IS NOT NULL THEN 'DELIVERY'
       WHEN _legacy_ts(p.d5) IS NOT NULL THEN 'PRODUCTION'
       ELSE 'DESIGN'
     END)::"ProductStatus",
    (CASE
       WHEN fd.force_done OR pr.stage = 'DONE'::"ProjectStage" THEN
         GREATEST(
           COALESCE(_legacy_ts(p.d9), _legacy_ts(p.d8), _legacy_ts(p.d6), _legacy_ts(p.d5), _legacy_ts(p.added), pr."stageChangedAt", now()),
           COALESCE(pr."stageChangedAt", now()))
       WHEN p.recl_open THEN _legacy_ts(p.recl_date)
       WHEN _legacy_ts(p.d9) IS NOT NULL THEN _legacy_ts(p.d9)
       WHEN _legacy_ts(p.d8) IS NOT NULL THEN _legacy_ts(p.d8)
       WHEN _legacy_ts(p.d6) IS NOT NULL THEN _legacy_ts(p.d6)
       WHEN _legacy_ts(p.d5) IS NOT NULL THEN _legacy_ts(p.d5)
       ELSE _legacy_ts(p.added)
     END),
    COALESCE(_legacy_num(p.cost), _legacy_num(p.cost_furniture)),
    NULLIF(btrim(p.tech), ''),
    CASE WHEN p.added_by ~ '^[0-9]+$' THEN 'legacy_user_' || p.added_by END,
    p.uid, 't181',
    COALESCE(_legacy_ts(p.added), now()), now()
  FROM dblink('legacy', $q$
    SELECT p.id::text, p.f2651, p.f2641, p.f2761::text, p.f4071::text, p.f56831,
           p.f2561::text, p.f2571::text, p.f26121::text,
           p.f9830::text, p.f56691::text, p.f9850::text, p.f9860::text,
           EXISTS(SELECT 1 FROM t211 rc WHERE COALESCE(rc.f3441, rc.f37741) = p.id
                  AND rc.f3581 IS NULL) AS recl_open,
           (SELECT min(rc.f3521)::text FROM t211 rc
            WHERE COALESCE(rc.f3441, rc.f37741) = p.id AND rc.f3581 IS NULL) AS recl_date
    FROM t181 p
    WHERE p.f2651 ~ '[0-9]'
  $q$) AS p(uid text, num text, kind text, cost text, cost_furniture text, tech text,
            added_by text, added text, touched text, d9 text, d8 text, d6 text, d5 text,
            recl_open boolean, recl_date text)
  JOIN "Project" pr ON pr.id = 'legacy_project_' || split_part(p.num, '.', 1)
  CROSS JOIN LATERAL (
    SELECT _legacy_ts(p.added) < c_year_ago OR _legacy_ts(p.touched) < c_half_ago AS force_done
  ) fd;

  -- ── 2.6 Рекламации (t211) → поля проекта ──────────────────────────────────
  UPDATE "Project" pr SET
    "reclamationReason"      = rc.problem,
    "reclamationDescription" = COALESCE(rc.letter, rc.progress),
    "reclamationFault"       = rc.faults
  FROM dblink('legacy', $q$
    SELECT split_part(p.f2651, '.', 1) AS grp,
           string_agg(DISTINCT btrim(rc.f3481), E'\n') FILTER (WHERE COALESCE(btrim(rc.f3481), '') <> '') AS problem,
           string_agg(DISTINCT btrim(rc.f3491), E'\n') FILTER (WHERE COALESCE(btrim(rc.f3491), '') <> '') AS letter,
           string_agg(DISTINCT btrim(rc.f3561), E'\n') FILTER (WHERE COALESCE(btrim(rc.f3561), '') <> '') AS progress,
           string_agg(DISTINCT btrim(rc.f36391), E'\n') FILTER (WHERE COALESCE(btrim(rc.f36391), '') <> '') AS faults
    FROM t211 rc
    JOIN t181 p ON p.id = COALESCE(rc.f3441, rc.f37741)
    WHERE p.f2651 ~ '[0-9]'
    GROUP BY 1
  $q$) AS rc(grp text, problem text, letter text, progress text, faults text)
  WHERE pr."legacyTable" = 't181' AND pr."legacyId" = rc.grp;

  -- ── 2.7 Заявки-лиды (t241, не конвертированные в заказы) → Проекты ────────
  -- Старые/неактивные заявки → REFUSED (не конвертированы = упущенный лид).
  INSERT INTO "Project" (id, number, title, stage, "stageChangedAt", currency,
                         "refusalReason", "refusalComment",
                         "managerId", "clientId",
                         "legacyId", "legacyTable", "createdAt", "updatedAt")
  SELECT
    'legacy_lead_' || z.uid,
    'CRM-' || z.uid,
    COALESCE(NULLIF(btrim(z.item_name), ''), NULLIF(btrim(z.fio), ''), 'Заявка ' || z.uid),
    (CASE
       WHEN fd.force_done THEN 'REFUSED'
       WHEN z.refusal_id IS NOT NULL THEN 'REFUSED'
       WHEN _legacy_ts(z.d_measure) IS NOT NULL OR _legacy_ts(z.d_calc) IS NOT NULL THEN 'ESTIMATE'
       ELSE 'LEAD'
     END)::"ProjectStage",
    COALESCE(
      CASE WHEN fd.force_done THEN LEAST(_legacy_ts(z.touched), now()) END,
      CASE WHEN z.refusal_id IS NOT NULL THEN _legacy_ts(z.d_refusal) END,
      _legacy_ts(z.d_measure), _legacy_ts(z.d_calc),
      _legacy_ts(z.d_first), _legacy_ts(z.added), now()),
    'BYN',
    CASE
      WHEN fd.force_done AND z.refusal_id IS NULL
      THEN 'Не конвертирована в заказ (импорт из v1)'
      ELSE NULLIF(btrim(z.refusal_name), '')
    END,
    NULLIF(btrim(z.refusal_desc), ''),
    CASE WHEN z.manager_uid ~ '^[0-9]+$' THEN 'legacy_user_' || z.manager_uid END,
    CASE
      WHEN z.lead_card_canon IS NOT NULL THEN 'legacy_client_' || z.lead_card_canon
      WHEN z.name_canon IS NOT NULL THEN 'legacy_client_' || z.name_canon
      ELSE 'legacy_client_auto_' || left(md5(_legacy_name(z.fio)), 12)
    END,
    z.uid, 't241',
    COALESCE(_legacy_ts(z.added), now()), now()
  FROM dblink('legacy', $q$
    SELECT z.id::text, z.f4601, z.f4621, z.f42931, z.f8250::text, z.f4581::text,
           z.f36821::text AS refusal_id, r.f36871 AS refusal_name, z.f37121 AS refusal_desc,
           z.f6461::text AS d_refusal, z.f6431::text AS d_measure, z.f6421::text AS d_calc,
           z.f4591::text AS d_first, z.f4551::text AS added, z.f26101::text AS touched,
            (SELECT c2.id::text FROM t320 c2
             WHERE lower(regexp_replace(regexp_replace(btrim(COALESCE(c2.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                 = lower(regexp_replace(regexp_replace(btrim(COALESCE(z.f4601,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
             ORDER BY (COALESCE(c2.f8260,'') = ''), c2.id LIMIT 1) AS name_canon,
            CASE WHEN z.f8250 IS NULL THEN NULL ELSE
              (SELECT canon.id::text FROM t320 c1, LATERAL (
                 SELECT c2.id FROM t320 c2
                 WHERE lower(regexp_replace(regexp_replace(btrim(COALESCE(c2.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                     = lower(regexp_replace(regexp_replace(btrim(COALESCE(c1.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                 ORDER BY (COALESCE(c2.f8260,'') = ''), c2.id LIMIT 1) canon
               WHERE c1.id = z.f8250 LIMIT 1)
            END AS lead_card_canon
    FROM t241 z
    LEFT JOIN t1681 r ON r.id = z.f36821
    WHERE NOT EXISTS (SELECT 1 FROM t181 p WHERE p.f34671 = z.id)
  $q$) AS z(uid text, fio text, phone text, item_name text, card text, manager_uid text,
            refusal_id text, refusal_name text, refusal_desc text,
            d_refusal text, d_measure text, d_calc text, d_first text, added text,
            touched text, name_canon text, lead_card_canon text)
  CROSS JOIN LATERAL (
    SELECT _legacy_ts(z.added) < c_year_ago OR _legacy_ts(z.touched) < c_half_ago AS force_done
  ) fd
  WHERE z.lead_card_canon IS NOT NULL OR COALESCE(btrim(z.fio), '') <> '';

  -- ── 2.8 История этапов/статусов: по одной записи на сущность ──────────────
  INSERT INTO "ProjectStageHistory" (id, "projectId", "fromStage", "toStage", "comment", "createdAt")
  SELECT 'legacy_psh_' || p.id, p.id, NULL::"ProjectStage", p.stage,
         'Импорт legacy', p."stageChangedAt"
  FROM "Project" p;

  INSERT INTO "ProductStatusHistory" (id, "productId", "fromStatus", "toStatus", "comment", "createdAt")
  SELECT 'legacy_prsh_' || pr.id, pr.id, NULL::"ProductStatus", pr.status,
         'Импорт legacy', pr."statusChangedAt"
  FROM "Product" pr;

  -- ── 2.9 Прайсы (t1121 «Справочник Работы») ────────────────────────────────
  INSERT INTO "PriceItem" (id, name, unit, price, category, active,
                           "legacyId", "legacyTable", "createdAt", "updatedAt")
  SELECT
    'legacy_priceitem_' || r.uid,
    COALESCE(NULLIF(btrim(r.name), ''), 'Работа ' || r.uid),
    COALESCE(NULLIF(btrim(r.unit), ''), 'шт'),
    COALESCE(_legacy_num(r.tariff), 0),
    NULLIF(btrim(r.stage_name), ''),
    true,
    r.uid, 't1121',
    COALESCE(_legacy_ts(r.added), now()), now()
  FROM dblink('legacy', $q$
    SELECT r.id::text, r.f27761, r.f29001, r.f27791::text, s.f17221 AS stage_name, r.f27741::text AS added
    FROM t1121 r
    LEFT JOIN t661 s ON s.id = r.f27771
  $q$) AS r(uid text, name text, unit text, tariff text, stage_name text, added text);

  -- ── 2.10 Работы (t1141 «Работы в ЗАКАЗЕ») ─────────────────────────────────
  INSERT INTO "Work" (id, "projectId", "productId", "priceItemId", title,
                      quantity, "priceSnapshot", total, "createdById", "createdAt")
  SELECT
    'legacy_work_' || w.uid,
    'legacy_project_' || split_part(w.order_num, '.', 1),
    'legacy_product_' || w.order_id,
    CASE WHEN w.price_id ~ '^[0-9]+$' THEN 'legacy_priceitem_' || w.price_id END,
    COALESCE(NULLIF(btrim(w.price_name), ''), 'Работа ' || w.uid),
    COALESCE(_legacy_num(w.qty), 1),
    COALESCE(_legacy_num(w.tariff),
             CASE WHEN COALESCE(_legacy_num(w.qty), 1) > 0
                  THEN _legacy_num(w.total) / COALESCE(_legacy_num(w.qty), 1) END, 0),
    COALESCE(_legacy_num(w.total),
             COALESCE(_legacy_num(w.tariff), 0) * COALESCE(_legacy_num(w.qty), 1), 0),
    CASE WHEN w.added_by ~ '^[0-9]+$' THEN 'legacy_user_' || w.added_by END,
    COALESCE(_legacy_ts(w.added), now())
  FROM dblink('legacy', $q$
    SELECT w.id::text, o.id::text AS order_id, o.f2651 AS order_num,
           w.f27981::text AS price_id, pi.f27761 AS price_name,
           w.f28341::text AS qty, w.f28361::text AS tariff, w.f28111::text AS total,
           w.f27921::text AS added_by, w.f27931::text AS added
    FROM t1141 w
    JOIN t631 tp ON tp.id = w.f27951
    JOIN t181 o ON o.id = tp.f18811
    LEFT JOIN t1121 pi ON pi.id = w.f27981
    WHERE o.f2651 ~ '[0-9]'
  $q$) AS w(uid text, order_id text, order_num text, price_id text, price_name text,
            qty text, tariff text, total text, added_by text, added text)
  JOIN "Product" prod ON prod.id = 'legacy_product_' || w.order_id;

  -- ── 2.11 Задания (t47 «Задания») → Задачи ─────────────────────────────────
  -- Привязка: заказ → проект; заявка → её проект; клиент с единственным
  -- проектом → туда. Остальные — пропускаются (лог верификации).
  INSERT INTO "Task" (id, "projectId", "productId", title, type, status,
                      "assigneeId", "dueAt", "doneAt", "doneById", "createdById",
                      "legacyId", "legacyTable", "createdAt", "updatedAt")
  SELECT
    'legacy_task_' || t.uid,
    t.project_id,
    t.product_id,
    COALESCE(NULLIF(btrim(t.descr), ''), 'Задание ' || t.uid),
    NULL,
    (CASE
       WHEN btrim(t.done) = 'Да' THEN 'DONE'
       WHEN t.assignee_uid IS NULL THEN 'DRAFT'
       ELSE 'NEW'
     END)::"TaskStatus",
    CASE WHEN t.assignee_uid ~ '^[0-9]+$' THEN 'legacy_user_' || t.assignee_uid END,
    COALESCE(_legacy_ts(t.due), _legacy_ts(t.deadline)),
    CASE WHEN btrim(t.done) = 'Да' THEN _legacy_ts(t.done_date) END,
    CASE WHEN btrim(t.done) = 'Да' AND t.assignee_uid ~ '^[0-9]+$'
         THEN 'legacy_user_' || t.assignee_uid END,
    CASE WHEN t.assigned_by ~ '^[0-9]+$' THEN 'legacy_user_' || t.assigned_by END,
    t.uid, 't47',
    COALESCE(_legacy_ts(t.added), now()), now()
  FROM (
    SELECT f.*,
      CASE
        WHEN f.order_id IS NOT NULL THEN 'legacy_project_' || split_part(f.order_num, '.', 1)
        WHEN f.crm_id IS NOT NULL THEN f.lead_or_order_project
      END AS project_id,
      CASE WHEN f.order_id IS NOT NULL THEN 'legacy_product_' || f.order_id END AS product_id
    FROM dblink('legacy', $q$
      SELECT t.id::text, t.f492::text AS assignee_uid, t.f500 AS descr, t.f501,
             t.f20181::text AS done_date, t.f20211::text AS due, t.f57041::text AS deadline,
             t.f921::text AS assigned_by, t.f922::text AS added,
             o.id::text AS order_id, o.f2651 AS order_num, z.id::text AS crm_id,
             CASE
               WHEN z.id IS NOT NULL THEN
                 COALESCE((SELECT 'legacy_project_' || split_part(o2.f2651, '.', 1)
                           FROM t181 o2 WHERE o2.f34671 = z.id LIMIT 1),
                          'legacy_lead_' || z.id::text)
             END AS lead_or_order_project
      FROM t47 t
      LEFT JOIN t181 o ON o.id = COALESCE(t.f52901, t.f57681)
      LEFT JOIN t241 z ON z.id = t.f52891
      WHERE o.id IS NULL OR o.f2651 ~ '[0-9]'
    $q$) AS f(uid text, assignee_uid text, descr text, done text, done_date text,
              due text, deadline text, assigned_by text, added text,
              order_id text, order_num text, crm_id text, lead_or_order_project text)
  ) t
  WHERE t.project_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM "Project" q WHERE q.id = t.project_id);

  -- Задания без заказа/заявки, но с клиентом, у которого ровно один проект
  INSERT INTO "Task" (id, "projectId", "productId", title, type, status,
                      "assigneeId", "dueAt", "doneAt", "doneById", "createdById",
                      "legacyId", "legacyTable", "createdAt", "updatedAt")
  SELECT
    'legacy_task_' || t.uid,
    one.id,
    NULL,
    COALESCE(NULLIF(btrim(t.descr), ''), 'Задание ' || t.uid),
    NULL,
    (CASE
       WHEN btrim(t.done) = 'Да' THEN 'DONE'
       WHEN t.assignee_uid IS NULL THEN 'DRAFT'
       ELSE 'NEW'
     END)::"TaskStatus",
    CASE WHEN t.assignee_uid ~ '^[0-9]+$' THEN 'legacy_user_' || t.assignee_uid END,
    COALESCE(_legacy_ts(t.due), _legacy_ts(t.deadline)),
    CASE WHEN btrim(t.done) = 'Да' THEN _legacy_ts(t.done_date) END,
    CASE WHEN btrim(t.done) = 'Да' AND t.assignee_uid ~ '^[0-9]+$'
         THEN 'legacy_user_' || t.assignee_uid END,
    CASE WHEN t.assigned_by ~ '^[0-9]+$' THEN 'legacy_user_' || t.assigned_by END,
    t.uid, 't47',
    COALESCE(_legacy_ts(t.added), now()), now()
  FROM dblink('legacy', $q$
    SELECT t.id::text, t.f492::text AS assignee_uid, t.f500 AS descr, t.f501,
           t.f20181::text AS done_date, t.f20211::text AS due, t.f57041::text AS deadline,
           t.f921::text AS assigned_by, t.f922::text AS added, t.f50761::text AS client_id
    FROM t47 t
    WHERE t.f52901 IS NULL AND t.f57681 IS NULL AND t.f52891 IS NULL
      AND t.f50761 IS NOT NULL
  $q$) AS t(uid text, assignee_uid text, descr text, done text, done_date text,
            due text, deadline text, assigned_by text, added text, client_id text)
  JOIN LATERAL (
    SELECT p.id, (SELECT count(*) FROM "Project" p2
                  WHERE p2."clientId" = 'legacy_client_' || t.client_id) AS cnt
    FROM "Project" p
    WHERE p."clientId" = 'legacy_client_' || t.client_id
    ORDER BY p."createdAt" LIMIT 1
  ) one ON one.cnt = 1
  ON CONFLICT (id) DO NOTHING;

  -- Правило давности: задачи старых/неактивных проектов → DONE
  UPDATE "Task" tk SET
    status   = 'DONE'::"TaskStatus",
    "doneAt" = COALESCE(tk."doneAt", pr."stageChangedAt", tk."createdAt")
  FROM "Project" pr
  WHERE tk."projectId" = pr.id
    AND tk.status <> 'DONE'
    AND (pr."createdAt" < c_year_ago OR pr."stageChangedAt" < c_half_ago)
    AND pr.stage <> 'REFUSED';

  -- ── 2.12 Коммуникации (t2551) ─────────────────────────────────────────────
  -- Привязка: договор → проект; заявка → её проект; клиент с единственным
  -- проектом → туда. Тип: переписка через аккаунт → MESSENGER, иначе NOTE.
  INSERT INTO "Communication" (id, "projectId", "clientId", type, text, "happenedAt",
                               "createdById", "createdAt")
  SELECT
    'legacy_comm_' || c.id,
    COALESCE(link.project_id, c.lead_or_order_project, one.id),
    -- клиент коммуникации: карта может быть дублем → канонизируем по имени
    CASE WHEN c.client_canon IS NOT NULL THEN 'legacy_client_' || c.client_canon END,
    (CASE WHEN c.account_id IS NOT NULL THEN 'MESSENGER' ELSE 'NOTE' END)::"CommunicationType",
    COALESCE(NULLIF(btrim(c.body), ''), NULLIF(btrim(c.subject), ''), '(без текста)'),
    COALESCE(_legacy_ts(c.happened), _legacy_ts(c.added), now()),
    CASE WHEN c.added_by ~ '^[0-9]+$' THEN 'legacy_user_' || c.added_by END,
    COALESCE(_legacy_ts(c.added), now())
  FROM dblink('legacy', $q$
    SELECT c.id::text, c.f50871::text AS client_id, c.f50861::text AS account_id,
           c.f51001 AS body, c.f50991 AS subject, c.f50841::text AS happened,
           c.f50821::text AS added, c.f50811::text AS added_by,
           o.id::text AS order_id, o.f2651 AS order_num, z.id::text AS crm_id,
           CASE
             WHEN z.id IS NOT NULL THEN
               COALESCE((SELECT 'legacy_project_' || split_part(o2.f2651, '.', 1)
                         FROM t181 o2 WHERE o2.f34671 = z.id LIMIT 1),
                        'legacy_lead_' || z.id::text)
           END AS lead_or_order_project,
           CASE WHEN c.f50871 IS NULL THEN NULL ELSE
             (SELECT canon.id::text FROM t320 c1, LATERAL (
                SELECT c2.id FROM t320 c2
                WHERE lower(regexp_replace(regexp_replace(btrim(COALESCE(c2.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                    = lower(regexp_replace(regexp_replace(btrim(COALESCE(c1.f8060,'')), '[.,;:()«»"''-]', '', 'g'), '\s+', ' ', 'g'))
                ORDER BY (COALESCE(c2.f8260,'') = ''), c2.id LIMIT 1) canon
              WHERE c1.id = c.f50871 LIMIT 1)
           END AS client_canon
    FROM t2551 c
    LEFT JOIN t181 o ON o.id = c.f50901
    LEFT JOIN t241 z ON z.id = c.f50891
    WHERE o.id IS NULL OR o.f2651 ~ '[0-9]'
  $q$) AS c(id text, client_id text, account_id text, body text, subject text,
            happened text, added text, added_by text,
            order_id text, order_num text, crm_id text, lead_or_order_project text,
            client_canon text)
  LEFT JOIN LATERAL (
    SELECT 'legacy_project_' || split_part(c.order_num, '.', 1) AS project_id
    WHERE c.order_id IS NOT NULL
  ) link ON true
  LEFT JOIN LATERAL (
    SELECT p.id, (SELECT count(*) FROM "Project" p2
                  WHERE p2."clientId" = 'legacy_client_' || c.client_id) AS cnt
    FROM "Project" p
    WHERE p."clientId" = 'legacy_client_' || c.client_id
    ORDER BY p."createdAt" LIMIT 1
  ) one ON one.cnt = 1
  WHERE COALESCE(link.project_id, c.lead_or_order_project, one.id) IS NOT NULL
    AND (link.project_id IS NULL
         OR EXISTS (SELECT 1 FROM "Project" q WHERE q.id = link.project_id));

  -- ── 2.13 Склад: категории (t1411) и номенклатура (t1441) ──────────────────
  INSERT INTO "MaterialCategory" (id, name, comment, active, "createdAt", "updatedAt")
  SELECT 'legacy_matcat_' || g.uid, COALESCE(NULLIF(btrim(g.name), ''), 'Без названия'),
         NULLIF(btrim(g.comment), ''), true, COALESCE(_legacy_ts(g.added), now()), now()
  FROM dblink('legacy', 'SELECT id::text, f31021, f33921, f31001::text FROM t1411')
    AS g(uid text, name text, comment text, added text);

  INSERT INTO "Material" (id, name, sku, unit, "categoryId", "purchasePrice",
                          "minStock", active, comment, "legacyId", "legacyTable",
                          "createdAt", "updatedAt")
  SELECT
    'legacy_material_' || n.uid,
    COALESCE(NULLIF(btrim(n.name), ''), 'Номенклатура ' || n.uid),
    NULLIF(btrim(n.sku), ''),
    (CASE btrim(COALESCE(n.unit_name, ''))
       WHEN 'м2' THEN 'м²'
       WHEN 'пог.м' THEN 'м.п.'
       WHEN 'уп' THEN 'упак'
       WHEN '' THEN 'шт'
       WHEN 'хл' THEN 'шт'
       WHEN 'рул' THEN 'шт'
       WHEN 'пар' THEN 'шт'
       WHEN 'л' THEN 'шт'
       WHEN 'м3' THEN 'шт'
       ELSE btrim(n.unit_name)
     END),
    CASE WHEN n.cat_id ~ '^[0-9]+$' THEN 'legacy_matcat_' || n.cat_id END,
    _legacy_num(n.price),
    _legacy_num(n.min_stock),
    true,
    NULLIF(btrim(n.spec), ''),
    n.uid, 't1441',
    COALESCE(_legacy_ts(n.added), now()), now()
  FROM dblink('legacy', $q$
    SELECT n.id::text, n.f31231, n.f31321, u.f31131 AS unit_name, n.f31241::text AS cat_id,
           n.f31401::text AS price, n.f31351::text AS min_stock, n.f31481 AS spec,
           n.f31211::text AS added
    FROM t1441 n
    LEFT JOIN t1421 u ON u.id = n.f31341
  $q$) AS n(uid text, name text, sku text, unit_name text, cat_id text,
            price text, min_stock text, spec text, added text);

  -- ── 2.14 Потребности изделий (t1531 «Номенклатура в заказах») ─────────────
  -- GROUP BY (изделие, материал) под @@unique; issuedQty = «Реализовано (кол-во)».
  INSERT INTO "ProjectMaterial" (id, "productId", "materialId", quantity, "issuedQty",
                                 "createdById", "createdAt", "updatedAt")
  SELECT
    'legacy_pmat_' || md5(m.order_id || '|' || m.mat_id),
    'legacy_product_' || m.order_id,
    'legacy_material_' || m.mat_id,
    COALESCE(m.qty, 0),
    COALESCE(m.issued, 0),
    CASE WHEN m.added_by ~ '^[0-9]+$' THEN 'legacy_user_' || m.added_by END,
    now(), now()
  FROM dblink('legacy', $q$
    SELECT o.id::text AS order_id, n.f32591::text AS mat_id,
           SUM(COALESCE(n.f32601, n.f35501, 0)) AS qty,
           SUM(COALESCE(n.f36061, 0)) AS issued,
           min(n.f32551)::text AS added_by
    FROM t1531 n
    JOIN t181 o ON o.id = n.f32581
    WHERE o.f2651 ~ '[0-9]'
    GROUP BY 1, 2
    HAVING SUM(COALESCE(n.f32601, n.f35501, 0)) > 0
  $q$) AS m(order_id text, mat_id text, qty numeric, issued numeric, added_by text)
  JOIN "Product" prod ON prod.id = 'legacy_product_' || m.order_id
  WHERE m.mat_id ~ '^[0-9]+$'
  ON CONFLICT ("productId", "materialId") DO UPDATE
    SET quantity = EXCLUDED.quantity, "issuedQty" = EXCLUDED."issuedQty";

  -- ── 2.15 Движения склада (t1641 «Учёт движения») ──────────────────────────
  -- INCOME: поступления/оприходования; EXPENSE: реализации (списания).
  -- Резервы и все «Отмена…» не переносятся (резерв = сама потребность в v2).
  INSERT INTO "StockMovement" (id, "materialId", type, quantity, "unitPrice", "totalByn",
                               "productId", "projectMaterialId", comment,
                               "createdById", "createdAt")
  SELECT
    'legacy_stockmv_' || s.id,
    'legacy_material_' || s.mat_id,
    s.mtype::"StockMovementType",
    s.qty,
    _legacy_num(s.unit_price),
    s.qty * _legacy_num(s.unit_price),
    CASE WHEN s.order_id IS NOT NULL THEN 'legacy_product_' || s.order_id END,
    pm.id,
    'Импорт legacy: ' || btrim(s.action),
    CASE WHEN s.added_by ~ '^[0-9]+$' THEN 'legacy_user_' || s.added_by END,
    COALESCE(_legacy_ts(s.added), now())
  FROM dblink('legacy', $q$
    SELECT v.id::text, v.f34931::text AS mat_id, v.f35001 AS action,
           v.mtype, v.qty, v.f35051::text AS unit_price,
           v.f35061::text AS order_id, v.f34901::text AS added_by, v.f34911::text AS added
    FROM (
      SELECT r.*, CASE
               WHEN r.f35001 IN ('Поступление на склад', 'Создание оприходования')
                 THEN 'INCOME'
               WHEN r.f35001 IN ('Создание реализации с резерва', 'Создание реализации со склада',
                                 'Создание требования-накладной')
                 THEN 'EXPENSE'
             END AS mtype,
             CASE
               WHEN r.f35001 IN ('Поступление на склад', 'Создание оприходования')
                 THEN COALESCE(r.f35011, r.f35021, 0)
               ELSE COALESCE(r.f35021, r.f35011, 0)
             END AS qty
      FROM t1641 r
    ) v
    WHERE v.mtype IS NOT NULL AND v.qty > 0
  $q$) AS s(id text, mat_id text, action text, mtype text, qty numeric,
            unit_price text, order_id text, added_by text, added text)
  JOIN "Material" mt ON mt.id = 'legacy_material_' || s.mat_id
  LEFT JOIN "Product" prod ON prod.id = 'legacy_product_' || s.order_id
  LEFT JOIN "ProjectMaterial" pm
    ON pm."productId" = 'legacy_product_' || s.order_id
   AND pm."materialId" = 'legacy_material_' || s.mat_id
  WHERE (s.order_id IS NULL OR prod.id IS NOT NULL);

  -- ── 2.16 Файлы: метаданные (содержимое копирует import-legacy-files.ts) ───
  -- Переносятся только файлы импортируемых сущностей: t181 (изделия),
  -- t241 (заявки → их проекты), t47 (задачи). Файлы финансов (t300, t430,
  -- t360 и пр.) не переносятся — финансовая история не импортируется.
  -- Категория по legacy-полю: f3851 → фото эскиз, f5081 → замер,
  -- f9380 → документы инженера (чертежи), остальное → документ.
  INSERT INTO "File" (id, "projectId", "productId", "taskId", category, stage,
                      "fileName", "storedName", "mimeType", size, "hasThumb",
                      "legacyId", "legacyTable", "createdAt")
  SELECT
    'legacy_file_' || f.fid,
    pr."projectId",
    pr.id,
    NULL,
    (CASE f.field_id
       WHEN 3851 THEN 'PHOTO'
       WHEN 5081 THEN 'MEASUREMENT'
       WHEN 9380 THEN 'DRAWING'
       ELSE 'DOCUMENT'
     END)::"FileCategory",
    -- Группа по назначению (плагин file-stages: Производство/Сборка/Монтаж):
    -- монтажные по имени («монтаж…», «установ…»); чертежи (документы
    -- инженера, деталировки, раскрои) — рабочая документация сборки →
    -- ASSEMBLY; остальное (эскизы, замеры, документы продаж) — PRODUCTION.
    (CASE
       WHEN lower(f.fname) LIKE '%монтаж%' OR lower(f.fname) LIKE '%установ%' THEN 'INSTALLATION'
       WHEN f.field_id = 9380 THEN 'ASSEMBLY'
       WHEN lower(f.fname) LIKE '%сборк%' THEN 'ASSEMBLY'
       WHEN lower(f.fname) LIKE '%чертеж%' OR lower(f.fname) LIKE '%чертёж%'
         OR lower(f.fname) LIKE '%деталировк%' OR lower(f.fname) LIKE '%раскрой%' THEN 'ASSEMBLY'
       ELSE 'PRODUCTION'
     END)::"FileStage",
    f.fname,
    f.fid || CASE WHEN f.ext <> '' THEN '.' || f.ext ELSE '' END,
    (CASE f.ext
       WHEN 'jpg' THEN 'image/jpeg'
       WHEN 'jpeg' THEN 'image/jpeg'
       WHEN 'png' THEN 'image/png'
       WHEN 'gif' THEN 'image/gif'
       WHEN 'webp' THEN 'image/webp'
       WHEN 'bmp' THEN 'image/bmp'
       WHEN 'heic' THEN 'image/heic'
       WHEN 'pdf' THEN 'application/pdf'
       WHEN 'doc' THEN 'application/msword'
       WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       WHEN 'xls' THEN 'application/vnd.ms-excel'
       WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ELSE 'application/octet-stream'
     END),
    f.fsize::int,
    false,
    f.fid, 'files',
    now()
  FROM dblink('legacy', $q$
    SELECT fl.id::text AS fid, fl.record_id::text AS rid, fl.file_name AS fname,
           fl.size::text AS fsize, fl.field_id,
           CASE WHEN fl.file_name LIKE '%.%'
                THEN lower(regexp_replace(fl.file_name, '^.*\.', ''))
                ELSE '' END AS ext
    FROM files fl
    WHERE fl.table_id = 181
      AND EXISTS (SELECT 1 FROM t181 p WHERE p.id = fl.record_id AND p.f2651 ~ '[0-9]')
  $q$) AS f(fid text, rid text, fname text, fsize text, field_id int, ext text)
  JOIN "Product" pr ON pr."legacyTable" = 't181' AND pr."legacyId" = f.rid;

  -- Файлы заявок → проект заявки (лид) или проект созданного из неё заказа
  INSERT INTO "File" (id, "projectId", "productId", "taskId", category, stage,
                      "fileName", "storedName", "mimeType", size, "hasThumb",
                      "legacyId", "legacyTable", "createdAt")
  SELECT
    'legacy_file_' || f.fid,
    COALESCE(lp.id, op.id),
    NULL, NULL,
    'DOCUMENT'::"FileCategory",
    -- Группа по назначению (плагин file-stages): монтажные/сборочные/чертежи
    -- по имени, остальные документы воронки — производственная подготовка.
    (CASE
       WHEN lower(f.fname) LIKE '%монтаж%' OR lower(f.fname) LIKE '%установ%' THEN 'INSTALLATION'
       WHEN lower(f.fname) LIKE '%сборк%' THEN 'ASSEMBLY'
       WHEN lower(f.fname) LIKE '%чертеж%' OR lower(f.fname) LIKE '%чертёж%'
         OR lower(f.fname) LIKE '%деталировк%' OR lower(f.fname) LIKE '%раскрой%' THEN 'ASSEMBLY'
       ELSE 'PRODUCTION'
     END)::"FileStage",
    f.fname,
    f.fid || CASE WHEN f.ext <> '' THEN '.' || f.ext ELSE '' END,
    (CASE f.ext
       WHEN 'jpg' THEN 'image/jpeg'
       WHEN 'jpeg' THEN 'image/jpeg'
       WHEN 'png' THEN 'image/png'
       WHEN 'gif' THEN 'image/gif'
       WHEN 'webp' THEN 'image/webp'
       WHEN 'bmp' THEN 'image/bmp'
       WHEN 'heic' THEN 'image/heic'
       WHEN 'pdf' THEN 'application/pdf'
       WHEN 'doc' THEN 'application/msword'
       WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       WHEN 'xls' THEN 'application/vnd.ms-excel'
       WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ELSE 'application/octet-stream'
     END),
    f.fsize::int,
    false,
    f.fid, 'files',
    now()
  FROM dblink('legacy', $q$
    SELECT fl.id::text AS fid, fl.record_id::text AS rid, fl.file_name AS fname,
           fl.size::text AS fsize,
           CASE WHEN fl.file_name LIKE '%.%'
                THEN lower(regexp_replace(fl.file_name, '^.*\.', ''))
                ELSE '' END AS ext,
           (SELECT split_part(o2.f2651, '.', 1) FROM t181 o2
            WHERE o2.f34671 = fl.record_id LIMIT 1) AS order_grp
    FROM files fl WHERE fl.table_id = 241
  $q$) AS f(fid text, rid text, fname text, fsize text, ext text, order_grp text)
  LEFT JOIN "Project" lp ON lp."legacyTable" = 't241' AND lp."legacyId" = f.rid
  LEFT JOIN "Project" op ON op."legacyTable" = 't181' AND op."legacyId" = f.order_grp
  WHERE COALESCE(lp.id, op.id) IS NOT NULL;

  -- Файлы заданий → задача (проект/изделие наследуются от задачи)
  INSERT INTO "File" (id, "projectId", "productId", "taskId", category, stage,
                      "fileName", "storedName", "mimeType", size, "hasThumb",
                      "legacyId", "legacyTable", "createdAt")
  SELECT
    'legacy_file_' || f.fid,
    tk."projectId",
    tk."productId",
    tk.id,
    'DOCUMENT'::"FileCategory",
    -- Группа по назначению (плагин file-stages): по имени файла.
    (CASE
       WHEN lower(f.fname) LIKE '%монтаж%' OR lower(f.fname) LIKE '%установ%' THEN 'INSTALLATION'
       WHEN lower(f.fname) LIKE '%сборк%' THEN 'ASSEMBLY'
       WHEN lower(f.fname) LIKE '%чертеж%' OR lower(f.fname) LIKE '%чертёж%'
         OR lower(f.fname) LIKE '%деталировк%' OR lower(f.fname) LIKE '%раскрой%' THEN 'ASSEMBLY'
       ELSE 'PRODUCTION'
     END)::"FileStage",
    f.fname,
    f.fid || CASE WHEN f.ext <> '' THEN '.' || f.ext ELSE '' END,
    (CASE f.ext
       WHEN 'jpg' THEN 'image/jpeg'
       WHEN 'jpeg' THEN 'image/jpeg'
       WHEN 'png' THEN 'image/png'
       WHEN 'gif' THEN 'image/gif'
       WHEN 'webp' THEN 'image/webp'
       WHEN 'bmp' THEN 'image/bmp'
       WHEN 'heic' THEN 'image/heic'
       WHEN 'pdf' THEN 'application/pdf'
       WHEN 'doc' THEN 'application/msword'
       WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       WHEN 'xls' THEN 'application/vnd.ms-excel'
       WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ELSE 'application/octet-stream'
     END),
    f.fsize::int,
    false,
    f.fid, 'files',
    now()
  FROM dblink('legacy', $q$
    SELECT fl.id::text AS fid, fl.record_id::text AS rid, fl.file_name AS fname,
           fl.size::text AS fsize,
           CASE WHEN fl.file_name LIKE '%.%'
                THEN lower(regexp_replace(fl.file_name, '^.*\.', ''))
                ELSE '' END AS ext
    FROM files fl WHERE fl.table_id = 47
  $q$) AS f(fid text, rid text, fname text, fsize text, ext text)
  JOIN "Task" tk ON tk."legacyTable" = 't47' AND tk."legacyId" = f.rid;

  PERFORM dblink_disconnect('legacy');

  END IF;
END
$legacy$;

-- Вспомогательные функции больше не нужны
DROP FUNCTION IF EXISTS _legacy_ts(text);
DROP FUNCTION IF EXISTS _legacy_num(text);
DROP FUNCTION IF EXISTS _legacy_name(text);
