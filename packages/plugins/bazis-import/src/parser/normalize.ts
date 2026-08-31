// Нормализация сырой модели BazisDocument в ImportDraft:
// кандидаты в изделия, деталировка (techData) и агрегаты с учётом кратностей.
//
// Правила кратности (проверено фикстурами):
// - <Количество> контейнеров (Сборка/Блок) УМНОЖАЕТ всё поддерево
//   (в фикстурах у всех контейнеров = 1, но правило поддержано);
// - ОсновнойМатериал панели (м²) УЖЕ умножен на <Количество> панели в самом XML
//   → дополнительно умножаем только на кратность контейнеров;
// - длина кромки (Длина в списках кромок) — на ОДНУ деталь → умножаем на
//   Количество панели и кратность контейнеров;
// - ОсновнойМатериал профиля (м.пог) УЖЕ умножен на <Количество> профиля
//   → умножаем только на кратность контейнеров;
// - Количество фурнитуры → умножаем на кратность контейнеров.
//
// Кромка: агрегат считается ТОЛЬКО из списков кромок панелей (стороны 1–4
// и «по чертежу»). Сопутствующие материалы («кромка в цвет дсп» и т.п.)
// дублируют этот расход (проверено: Σ совпадает до десятой доли метра),
// поэтому идут отдельной группой materials и в edging НЕ включаются.

import type {
  BazisContainer,
  BazisDocument,
  BazisElement,
  BazisFitting,
  BazisMaterialRef,
  BazisPanel,
  BazisProfile,
  DraftProduct,
  DraftQuantities,
  DraftTotals,
  ImportDraft,
  TechData,
  TechEdging,
  TechFitting,
  TechMaterial,
  TechPanel,
  TechProfile,
  TechProfileTotal,
} from "./types"

/** Заголовок loose-группы свободных деталей верхнего уровня. */
export const LOOSE_PRODUCT_TITLE = "Детали вне сборок"

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const pathToString = (path: string[]): string => path.join(" / ")

/**
 * Единица сопутствующего материала. Если ЕдИзм в XML пустая, а наименование
 * начинается с «кромка» (регистронезависимо) — это погонные метры ("m"),
 * иначе UI рисовал бы «шт» для метрового расхода.
 */
function extraUnit(extra: BazisMaterialRef): string {
  if (extra.unit === "" && extra.name.trim().toLowerCase().startsWith("кромка")) {
    return "m"
  }
  return extra.unit
}

/** Накопитель агрегатов одного изделия (или всего документа). */
class TechAccumulator {
  readonly panels: TechPanel[] = []
  readonly profiles: TechProfile[] = []
  private readonly fittings = new Map<string, TechFitting>()
  private readonly materials = new Map<string, TechMaterial>()
  private readonly edging = new Map<string, TechEdging>()
  private readonly profileTotals = new Map<string, TechProfileTotal>()
  boxesCount = 0

  addPanel(panel: BazisPanel, containerMult: number, parentPath: string[]): void {
    const qty = panel.qty * containerMult
    this.panels.push({
      position: panel.position,
      name: panel.name,
      code: panel.code,
      finishedLengthMm: panel.finishedLengthMm,
      finishedWidthMm: panel.finishedWidthMm,
      thicknessMm: panel.thicknessMm,
      qty,
      ...(panel.material
        ? {
            material: {
              name: panel.material.name,
              code: panel.material.code,
              // В XML уже × Количество панели → только кратность контейнеров.
              areaM2: round(panel.material.qty * containerMult, 6),
              ...(panel.material.thicknessMm !== undefined
                ? { thicknessMm: panel.material.thicknessMm }
                : {}),
              ...(panel.material.note !== undefined ? { note: panel.material.note } : {}),
            },
          }
        : {}),
      edges: panel.edges.map((edge) => ({
        side: edge.side,
        name: edge.name,
        code: edge.code,
        lengthMm: edge.lengthMm,
        thicknessMm: edge.thicknessMm,
        designation: edge.designation,
      })),
      parentPath,
      userProperties: panel.userProperties,
    })

    if (panel.material) {
      // Группировка ЛДСП/МДФ: по наименованию + толщине, м².
      this.addMaterial({
        name: panel.material.name,
        code: panel.material.code,
        unit: "m2",
        qty: panel.material.qty * containerMult,
        ...(panel.material.thicknessMm !== undefined
          ? { thicknessMm: panel.material.thicknessMm }
          : {}),
      })
    }
    for (const edge of panel.edges) {
      // Длина — на одну деталь → × Количество панели × кратность контейнеров.
      const key = `${edge.name}${edge.thicknessMm}`
      const existing = this.edging.get(key)
      const lengthMm = edge.lengthMm * qty
      if (existing) {
        existing.lengthMm += lengthMm
        existing.lengthM = round(existing.lengthMm / 1000, 3)
      } else {
        this.edging.set(key, {
          name: edge.name,
          thicknessMm: edge.thicknessMm,
          lengthMm,
          lengthM: round(lengthMm / 1000, 3),
        })
      }
    }
    for (const extra of panel.extraMaterials) {
      this.addExtraMaterial(extra, containerMult)
    }
  }

  addProfile(profile: BazisProfile, containerMult: number, parentPath: string[]): void {
    const qty = profile.qty * containerMult
    // В XML уже × Количество профиля → только кратность контейнеров.
    const lengthM = (profile.material?.qty ?? profile.lengthMm / 1000) * containerMult
    this.profiles.push({
      name: profile.name,
      code: profile.code,
      lengthMm: profile.lengthMm,
      qty,
      ...(profile.material
        ? {
            material: {
              name: profile.material.name,
              code: profile.material.code,
              lengthM: round(lengthM, 4),
            },
          }
        : {}),
      parentPath,
    })

    const key = `${profile.name}${profile.code}`
    const existing = this.profileTotals.get(key)
    if (existing) {
      existing.qty += qty
      existing.lengthMm += profile.lengthMm * qty
      existing.lengthM = round(existing.lengthMm / 1000, 3)
    } else {
      this.profileTotals.set(key, {
        name: profile.name,
        code: profile.code,
        qty,
        lengthMm: profile.lengthMm * qty,
        lengthM: round((profile.lengthMm * qty) / 1000, 3),
      })
    }
    if (profile.material) {
      this.addMaterial({
        name: profile.material.name,
        code: profile.material.code,
        unit: "m",
        qty: lengthM,
        ...(profile.material.thicknessMm !== undefined
          ? { thicknessMm: profile.material.thicknessMm }
          : {}),
      })
    }
    for (const extra of profile.extraMaterials) {
      this.addExtraMaterial(extra, containerMult)
    }
  }

  addFitting(fitting: BazisFitting, containerMult: number, parentPath: string[]): void {
    const qty = fitting.qty * containerMult
    const key = `${fitting.name}${fitting.code}${fitting.objectType}`
    const existing = this.fittings.get(key)
    const path = pathToString(parentPath)
    if (existing) {
      existing.qty += qty
      if (path !== "" && !existing.parentPaths.includes(path)) {
        existing.parentPaths.push(path)
      }
    } else {
      this.fittings.set(key, {
        name: fitting.name,
        code: fitting.code,
        objectType: fitting.objectType,
        qty,
        parentPaths: path === "" ? [] : [path],
      })
    }
    for (const extra of fitting.extraMaterials) {
      this.addExtraMaterial(extra, containerMult)
    }
  }

  /**
   * Сопутствующий материал: Количество в XML УЖЕ умножено на Количество
   * элемента-владельца (проверено фикстурами: «полка стекло» ×7 → 3.626 м)
   * → умножаем только на кратность контейнеров.
   */
  private addExtraMaterial(extra: BazisMaterialRef, containerMult: number): void {
    this.addMaterial({
      name: extra.name,
      code: extra.code,
      unit: extraUnit(extra),
      qty: extra.qty * containerMult,
      ...(extra.thicknessMm !== undefined ? { thicknessMm: extra.thicknessMm } : {}),
    })
  }

  addMaterial(material: TechMaterial): void {
    const key = `${material.name}${material.code}${material.unit}${material.thicknessMm ?? ""}`
    const existing = this.materials.get(key)
    if (existing) {
      existing.qty += material.qty
    } else {
      this.materials.set(key, { ...material })
    }
  }

  /** Рекурсивный обход поддерева: mult — произведение Количество контейнеров пути. */
  walk(elements: BazisElement[], mult: number, path: string[]): void {
    for (const element of elements) {
      if (element.kind === "container") {
        this.walkContainer(element, mult, path)
      } else if (element.kind === "panel") {
        this.addPanel(element, mult, path)
      } else if (element.kind === "profile") {
        this.addProfile(element, mult, path)
      } else {
        this.addFitting(element, mult, path)
      }
    }
  }

  walkContainer(container: BazisContainer, mult: number, path: string[]): void {
    const nextMult = mult * container.qty
    const name = container.name.trim().toLowerCase()
    // Эвристика «ящика»: наименование контейнера начинается со слова
    // «ящик» («Ящик SB18 H86…») или «короб ящика».
    if (name.startsWith("ящик") || name.startsWith("короб ящика")) {
      this.boxesCount += nextMult
    }
    this.walk(container.children, nextMult, [...path, container.name])
  }

  techData(): TechData {
    return {
      panels: this.panels,
      profiles: this.profiles,
      fittings: [...this.fittings.values()],
      materials: [...this.materials.values()],
      edging: [...this.edging.values()],
    }
  }

  /** Количества накопленного поддерева для правил шаблонов (per-product, этап B). */
  quantities(): DraftQuantities {
    return {
      panelsCount: this.panels.reduce((sum, panel) => sum + panel.qty, 0),
      panelsM2: round(
        [...this.materials.values()]
          .filter((material) => material.unit === "m2")
          .reduce((sum, material) => sum + material.qty, 0),
        4,
      ),
      edgingM: round(
        [...this.edging.values()].reduce((sum, edge) => sum + edge.lengthMm, 0) / 1000,
        3,
      ),
      boxesCount: this.boxesCount,
    }
  }

  totals(): DraftTotals {
    return {
      materials: [...this.materials.values()],
      edging: [...this.edging.values()],
      fittings: [...this.fittings.values()],
      profiles: [...this.profileTotals.values()],
    }
  }

  /** Сливает агрегаты другого накопителя (для totals документа). */
  merge(other: TechAccumulator): void {
    this.panels.push(...other.panels)
    this.profiles.push(...other.profiles)
    for (const fitting of other.fittings.values()) {
      const key = `${fitting.name}${fitting.code}${fitting.objectType}`
      const existing = this.fittings.get(key)
      if (existing) {
        existing.qty += fitting.qty
        for (const path of fitting.parentPaths) {
          if (!existing.parentPaths.includes(path)) existing.parentPaths.push(path)
        }
      } else {
        this.fittings.set(key, { ...fitting, parentPaths: [...fitting.parentPaths] })
      }
    }
    for (const material of other.materials.values()) {
      this.addMaterial(material)
    }
    for (const edge of other.edging.values()) {
      const key = `${edge.name}${edge.thicknessMm}`
      const existing = this.edging.get(key)
      if (existing) {
        existing.lengthMm += edge.lengthMm
        existing.lengthM = round(existing.lengthMm / 1000, 3)
      } else {
        this.edging.set(key, { ...edge })
      }
    }
    for (const profile of other.profileTotals.values()) {
      const key = `${profile.name}${profile.code}`
      const existing = this.profileTotals.get(key)
      if (existing) {
        existing.qty += profile.qty
        existing.lengthMm += profile.lengthMm
        existing.lengthM = round(existing.lengthMm / 1000, 3)
      } else {
        this.profileTotals.set(key, { ...profile })
      }
    }
    this.boxesCount += other.boxesCount
  }
}

/**
 * Строит ImportDraft из разобранного документа.
 * Кандидаты в изделия: верхнеуровневые Блок/Сборка каждого <Изделие>;
 * свободные верхнеуровневые объекты собираются в одну loose-группу
 * («Детали вне сборок», а если контейнеров нет вовсе — по имени изделия).
 */
export function buildImportDraft(doc: BazisDocument, fileName?: string): ImportDraft {
  const products: DraftProduct[] = []
  const totals = new TechAccumulator()

  doc.products.forEach((root, rootIndex) => {
    const loose: { element: BazisElement; index: number }[] = []
    let hasContainers = false

    root.elements.forEach((element, index) => {
      if (element.kind === "container") {
        hasContainers = true
        const acc = new TechAccumulator()
        acc.walkContainer(element, root.qty, [])
        products.push({
          key: `${rootIndex}/${index}`,
          title: element.name,
          kind: element.tag === "Блок" ? "block" : "assembly",
          ...(element.dims
            ? {
                dims: {
                  ...(element.dims.widthMm !== undefined ? { w: element.dims.widthMm } : {}),
                  ...(element.dims.heightMm !== undefined ? { h: element.dims.heightMm } : {}),
                  ...(element.dims.depthMm !== undefined ? { d: element.dims.depthMm } : {}),
                },
              }
            : {}),
          techData: acc.techData(),
          quantities: acc.quantities(),
        })
        totals.merge(acc)
      } else {
        loose.push({ element, index })
      }
    })

    if (loose.length > 0) {
      const acc = new TechAccumulator()
      acc.walk(
        loose.map((item) => item.element),
        root.qty,
        [],
      )
      products.push({
        key: `${rootIndex}/loose`,
        title: hasContainers ? LOOSE_PRODUCT_TITLE : root.name,
        kind: "loose",
        techData: acc.techData(),
        quantities: acc.quantities(),
      })
      totals.merge(acc)
    }

    // Материалы, добавленные вручную на уровне изделия, — только в totals.
    for (const material of root.manualMaterials) {
      totals.addMaterial({
        name: material.name,
        code: material.code,
        unit: material.unit,
        qty: material.qty * root.qty,
        ...(material.thicknessMm !== undefined
          ? { thicknessMm: material.thicknessMm }
          : {}),
      })
    }
  })

  const quantities: DraftQuantities = totals.quantities()

  return {
    source: {
      ...(fileName !== undefined ? { fileName } : {}),
      format: "bazis-xml",
      projectName: doc.projectName,
      ...(doc.version !== undefined ? { version: doc.version } : {}),
    },
    products,
    totals: totals.totals(),
    quantities,
  }
}
