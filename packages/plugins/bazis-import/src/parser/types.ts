// Типы парсера Базис-Мебельщик: сырая модель документа (BazisDocument)
// и нормализованный черновик импорта (ImportDraft).
//
// Единицы (везде, если не указано иное):
// - размеры и длины — миллиметры;
// - площади — м² (как в XML: ОсновнойМатериал панели);
// - длины в агрегатах кромки/профиля дополнительно дублируются в метрах
//   (округление до 3 знаков).

// ---------------------------------------------------------------------------
// Сырая модель (результат разбора XML, без агрегации)
// ---------------------------------------------------------------------------

/** Кромка панели. `side`: 1–4 — стороны панели, "drawing" — кромка по чертежу (СМ). */
export interface BazisEdge {
  side: 1 | 2 | 3 | 4 | "drawing"
  name: string
  code: string
  /** Длина на ОДНУ деталь (не умножена на Количество панели). */
  lengthMm: number
  widthMm: number
  thicknessMm: number
  designation: string
}

/** Ссылка на материал (ОсновнойМатериал / СопутствующийМатериал). */
export interface BazisMaterialRef {
  name: string
  code: string
  /**
   * Количество как в XML. У панелей — м² и УЖЕ умножено на Количество панели
   * (проверено фикстурами: matQty = Длина×Ширина/1e6 × Количество).
   * У профилей — м.пог и тоже уже умножено на Количество профиля.
   * Кратность родительских контейнеров НЕ включена нигде.
   */
  qty: number
  /** Единица из XML (у сопутствующих; в фикстурах часто пустая). */
  unit: string
  thicknessMm?: number
  note?: string
}

/** Объект-Панель. */
export interface BazisPanel {
  kind: "panel"
  name: string
  code: string
  qty: number
  position: string
  /** Размеры заготовки (Длина/Ширина). */
  lengthMm: number
  widthMm: number
  /** Размеры готовой детали. */
  finishedLengthMm: number
  finishedWidthMm: number
  thicknessMm: number
  grainDirection?: string
  /** Объединение СписокКромок1..4 и СписокКромокСМЧертеж; пустые кромки (без имени) отброшены. */
  edges: BazisEdge[]
  material?: BazisMaterialRef
  extraMaterials: BazisMaterialRef[]
  userProperties: Record<string, string>
}

/** Объект-Профиль. */
export interface BazisProfile {
  kind: "profile"
  name: string
  code: string
  qty: number
  position: string
  lengthMm: number
  material?: BazisMaterialRef
  extraMaterials: BazisMaterialRef[]
}

/**
 * Листовой фурнитурный объект: Объект/Фурнитура или Объект/Сборка
 * (петли, экраны и т.п. — в фикстурах Объект/Сборка детей не имеет).
 */
export interface BazisFitting {
  kind: "fitting"
  /** ТипОбъекта из XML: "Фурнитура", "Сборка" или иной. */
  objectType: string
  name: string
  code: string
  qty: number
  position: string
  material?: BazisMaterialRef
  extraMaterials: BazisMaterialRef[]
}

/** Контейнер: тег Сборка или Блок (любого ТипОбъекта, в т.ч. «Составная фурнитура»). */
export interface BazisContainer {
  kind: "container"
  tag: "Сборка" | "Блок"
  /** ТипОбъекта из XML: "Сборка", "Составная фурнитура", "Блок". */
  objectType: string
  name: string
  qty: number
  position: string
  dims?: { widthMm?: number; heightMm?: number; depthMm?: number }
  children: BazisElement[]
}

export type BazisElement = BazisContainer | BazisPanel | BazisProfile | BazisFitting

/** Корневое <Изделие> (в фикстурах всегда одно, формат допускает несколько). */
export interface BazisProductRoot {
  name: string
  qty: number
  elements: BazisElement[]
  /** Материалы из <ДобавленоВручную> (в фикстурах пусто; идут только в totals). */
  manualMaterials: BazisMaterialRef[]
}

/** Сырой документ после XML-разбора. */
export interface BazisDocument {
  projectName: string
  projectNumber?: string
  version?: string
  products: BazisProductRoot[]
}

// ---------------------------------------------------------------------------
// Нормализованный черновик импорта (ImportDraft → PluginImportBatch.draft)
// ---------------------------------------------------------------------------

/** Панель в деталировке изделия. */
export interface TechPanel {
  position: string
  name: string
  code: string
  finishedLengthMm: number
  finishedWidthMm: number
  thicknessMm: number
  /** Эффективное количество: Количество панели × кратность контейнеров на пути. */
  qty: number
  material?: {
    name: string
    code: string
    /** м², эффективное (XML-количество × кратность контейнеров). */
    areaM2: number
    thicknessMm?: number
    note?: string
  }
  /** Кромки детали; lengthMm — на одну деталь. */
  edges: {
    side: 1 | 2 | 3 | 4 | "drawing"
    name: string
    code: string
    lengthMm: number
    thicknessMm: number
    designation: string
  }[]
  /** Путь контейнеров от изделия до панели (имена), без самой панели. */
  parentPath: string[]
  userProperties: Record<string, string>
}

/** Профиль в деталировке изделия. */
export interface TechProfile {
  name: string
  code: string
  lengthMm: number
  /** Эффективное количество (× кратность контейнеров). */
  qty: number
  material?: {
    name: string
    code: string
    /** м.пог, эффективное (XML-количество × кратность контейнеров). */
    lengthM: number
  }
  parentPath: string[]
}

/** Фурнитура, сгруппированная по (наименование, код, тип объекта). */
export interface TechFitting {
  name: string
  code: string
  /** ТипОбъекта: "Фурнитура" (простая) или "Сборка" (фурнитурная сборка-элемент). */
  objectType: string
  /** Суммарное количество с учётом Количество элементов и кратности контейнеров. */
  qty: number
  /** Пути контейнеров, где встречается позиция (для комментариев), без дублей. */
  parentPaths: string[]
}

/** Материал, сгруппированный по (наименование, код, единица, толщина). */
export interface TechMaterial {
  name: string
  code: string
  /** "m2" — площадь панелей, "m" — погонаж профиля/кромки, иначе ЕдИзм из XML (может быть ""; кромка без ЕдИзм → "m"). */
  unit: string
  /** Суммарное количество с учётом всех кратностей. */
  qty: number
  thicknessMm?: number
}

/** Кромка, сгруппированная по (наименование, толщина). */
export interface TechEdging {
  name: string
  thicknessMm: number
  /** Суммарная длина в мм (Длина × Количество панели × кратность контейнеров). */
  lengthMm: number
  /** lengthMm / 1000, округление до 3 знаков. */
  lengthM: number
}

/** Профиль, сгруппированный по (наименование, код). */
export interface TechProfileTotal {
  name: string
  code: string
  /** Суммарный погонаж, мм. */
  lengthMm: number
  /** lengthMm / 1000, округление до 3 знаков. */
  lengthM: number
  /** Суммарное количество элементов-профилей (шт). */
  qty: number
}

/** Деталировка изделия (Product.techData). */
export interface TechData {
  panels: TechPanel[]
  profiles: TechProfile[]
  fittings: TechFitting[]
  /** Материалы: панельные (м²), профильные (м.пог) и сопутствующие (ЕдИзм из XML). */
  materials: TechMaterial[]
  /** Кромка из списков кромок панелей (стороны 1–4 и «по чертежу»). */
  edging: TechEdging[]
}

/** Агрегаты по всему документу. */
export interface DraftTotals {
  materials: TechMaterial[]
  edging: TechEdging[]
  fittings: TechFitting[]
  profiles: TechProfileTotal[]
}

/** Работа-черновик из шаблона (этап B): снимок расценки + количество по qtyRule. */
export interface DraftWork {
  priceItemId: string
  /** Наименование расценки на момент разворачивания шаблона. */
  title: string
  unit: string
  quantity: number
  /** Цена из PriceItem на момент preview (снимок). */
  price: number
  /** price × quantity, округление до 2 знаков. */
  total: number
}

/**
 * Задача-черновик из шаблона (этап B).
 * dependsOn — индексы внутри массива tasks ЭТОГО же изделия.
 */
export interface DraftTask {
  title: string
  type?: string
  estimateMinutes: number
  dependsOn: number[]
}

// ---------------------------------------------------------------------------
// Потребность в материалах склада (этап C)
// ---------------------------------------------------------------------------

/**
 * Потребность изделия в материале: собрана из деталировки (techData),
 * единица УЖЕ переведена в складскую (unitFromBazis: "m2"→"м²", "m"→"м.п.",
 * пусто/незнакомая → "шт", знакомая ЕдИзм из XML — как есть).
 */
export interface MaterialNeed {
  bazisName: string
  bazisCode?: string
  /** Складская единица ("м²"/"м.п."/"шт" или ЕдИзм из XML). */
  unit: string
  qty: number
  source: "material" | "edging" | "fitting" | "profile"
}

/** Потребность после разрешения маппинга (materialId есть = смаплено). */
export interface ResolvedNeed extends MaterialNeed {
  materialId?: string
  materialName?: string
  /** materialId из маппинга, которого нет в номенклатуре склада (диагностика). */
  orphanMaterialId?: string
}

/** Кандидат в Product. */
export interface DraftProduct {
  /** Стабильный ключ: "<индекс Изделие>/<индекс элемента>" или "<индекс Изделие>/loose". */
  key: string
  title: string
  /**
   * block — верхнеуровневый Блок; assembly — верхнеуровневая Сборка;
   * loose — группа свободных объектов верхнего уровня (вне сборок/блоков).
   */
  kind: "block" | "assembly" | "loose"
  dims?: { w?: number; h?: number; d?: number }
  /** Тип изделия — заполнит классификатор (этап B), на этапе A всегда undefined. */
  type?: string
  /**
   * false — тип подставлен классификатором по умолчанию (universal),
   * ни одно правило не совпало (подсветка на экране подтверждения).
   */
  typeMatched?: boolean
  /**
   * Пометка «не импортировать» с экрана подтверждения (этап A3):
   * продукт остаётся в драфте, но при применении пропускается.
   */
  excluded?: boolean
  techData: TechData
  /**
   * Количества ЭТОГО изделия для правил шаблонов (заполняет нормализация).
   * Для старых драфтов без поля движок шаблонов считает их из techData
   * (productQuantities в templates.ts).
   */
  quantities?: DraftQuantities
  /** Работы из шаблона типа (этап B): заполняет expandTemplate, правит экран подтверждения. */
  works?: DraftWork[]
  /** Задачи-черновики из шаблона типа (этап B). */
  tasks?: DraftTask[]
  /** Проблемы разворачивания шаблона (нет расценки, нулевое количество и т.п.). */
  problems?: string[]
  /**
   * Потребность в материалах склада (этап C): заполняет preview
   * (collectProductNeeds + resolveNeeds), apply пишет ProjectMaterial.
   */
  materials?: ResolvedNeed[]
}

/** Количества для правил шаблонов (qtyRule). */
export interface DraftQuantities {
  /** Число панелей-деталей (Σ эффективных количеств). */
  panelsCount: number
  /** Суммарная площадь основного материала панелей, м² (округление до 4 знаков). */
  panelsM2: number
  /** Суммарная длина кромки, м (округление до 3 знаков). */
  edgingM: number
  /**
   * Число «ящиков»: контейнеры, чьё наименование начинается со слова
   * «ящик» или «короб ящика» (регистронезависимо), × кратность.
   */
  boxesCount: number
}

/** Черновик импорта — главный результат нормализации. */
export interface ImportDraft {
  source: {
    fileName?: string
    format: "bazis-xml"
    projectName: string
    version?: string
  }
  products: DraftProduct[]
  totals: DraftTotals
  quantities: DraftQuantities
}
