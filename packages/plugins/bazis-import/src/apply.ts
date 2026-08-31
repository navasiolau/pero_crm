// Применение и откат импорта (этапы A2 + B + C): драфт превращается в изделия
// проекта, работы (снимок цены из прайса), задачи-черновики (DRAFT, с DAG
// зависимостей) и потребность склада (ProjectMaterial из materials изделия);
// пакет импорта фиксируется в PluginImportBatch — по нему работает откат.
//
// Свой PrismaClient пакет НЕ создаёт: клиент приходит параметром из хоста
// (apps/web), типы нужны только для компиляции.
import type { Prisma, PrismaClient } from "@prisma/client"

import type { ImportDraft } from "./parser"
import { topoOrder } from "./templates"
import type { TemplateTask } from "./settings"

const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const

export const BAZIS_IMPORT_PLUGIN_ID = "bazis-import"

/** Ссылки на созданные сущности — основа отката. */
export interface CreatedRefs {
  productIds: string[]
  taskIds: string[]
  workIds: string[]
  /**
   * Потребность склада: id строки ProjectMaterial + сколько количества
   * добавил импорт (addedQty). Строка могла существовать раньше — тогда
   * откат не удаляет её, а уменьшает quantity на addedQty.
   * Батчи этапов A/B писали сюда пустой массив; голые string-id
   * (гипотетический старый формат) читаются как { id } — откат удаляет строку.
   */
  projectMaterialIds: ProjectMaterialRef[]
}

/** Строка потребности, затронутая импортом. */
export interface ProjectMaterialRef {
  id: string
  addedQty?: number
}

export interface ApplyResult {
  batchId: string
  productIds: string[]
  numbers: string[]
  workIds: string[]
  taskIds: string[]
  /** Число строк потребности (ProjectMaterial), созданных/наращенных импортом. */
  materialsCount: number
}

export async function applyImportDraft(
  db: PrismaClient,
  args: {
    projectId: string
    draft: ImportDraft
    fileName?: string
    userId?: string
  },
): Promise<ApplyResult> {
  const { projectId, draft, fileName, userId } = args
  // С экрана подтверждения приходят и отмеченные «не импортировать» — пропускаем.
  const products = draft.products.filter((product) => product.excluded !== true)
  if (products.length === 0) {
    throw new Error("В черновике нет изделий для импорта")
  }

  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, number: true },
    })
    if (!project) throw new Error("Проект не найден")

    // Нумерация изделий: «<номер проекта>.<n>» (точка — единый стиль), n —
    // следующий суффикс в проекте по max(suffixInt). Зеркалит
    // nextProductSuffixInt из apps/web/src/server/products/actions.ts —
    // осознанное дублирование ради самодостаточности пакета.
    const siblings = await tx.product.findMany({
      where: { projectId: project.id },
      select: { suffixInt: true },
    })
    let max = 0
    for (const sibling of siblings) {
      if (sibling.suffixInt !== null && sibling.suffixInt > max) {
        max = sibling.suffixInt
      }
    }

    const productIds: string[] = []
    const workIds: string[] = []
    const taskIds: string[] = []
    const materialRefs: ProjectMaterialRef[] = []
    const numbers: string[] = []

    // Этап C: номенклатура, на которую ссылается драфт (materials[].materialId
    // проставил preview/экран подтверждения). Неактивные и несуществующие
    // считаем несмапленными — такие позиции пропускаем (UI предупреждает).
    const mappedIds = [
      ...new Set(
        products.flatMap((product) =>
          (product.materials ?? [])
            .map((need) => need.materialId)
            .filter((id): id is string => typeof id === "string" && id !== ""),
        ),
      ),
    ]
    const knownMaterials =
      mappedIds.length > 0
        ? await tx.material.findMany({
            where: { id: { in: mappedIds }, active: true },
            select: { id: true },
          })
        : []
    const knownIds = new Set(knownMaterials.map((material) => material.id))

    for (const product of products) {
      max += 1
      const number = `${project.number}.${max}`
      const created = await tx.product.create({
        data: {
          projectId: project.id,
          number,
          suffixInt: max,
          title: product.title,
          status: "DESIGN",
          statusChangedAt: new Date(),
          techData: product.techData as unknown as Prisma.InputJsonValue,
          createdById: userId,
          statusHistory: {
            create: { toStatus: "DESIGN", changedById: userId },
          },
        },
        select: { id: true },
      })
      productIds.push(created.id)
      numbers.push(number)

      // Работы из шаблона (этап B): цена и сумма уже посчитаны на preview
      // (снимок расценки) — здесь только фиксируем.
      for (const work of product.works ?? []) {
        const createdWork = await tx.work.create({
          data: {
            projectId: project.id,
            productId: created.id,
            priceItemId: work.priceItemId,
            title: work.title,
            quantity: work.quantity,
            priceSnapshot: work.price,
            total: work.total,
            createdById: userId,
          },
          select: { id: true },
        })
        workIds.push(createdWork.id)
      }

      // Задачи-черновики (этап B): без исполнителя и срока, estimateMinutes
      // обязательна по правилам ядра — приходит из шаблона. Создаём в
      // топологическом порядке, зависимости — по индексам шаблона.
      const draftTasks = product.tasks ?? []
      if (draftTasks.length > 0) {
        const order = topoOrder(draftTasks as TemplateTask[])
        const idsByIndex = new Array<string>(draftTasks.length)
        for (const index of order) {
          const draftTask = draftTasks[index]
          if (!draftTask) continue
          const createdTask = await tx.task.create({
            data: {
              projectId: project.id,
              productId: created.id,
              title: draftTask.title,
              type: draftTask.type ?? null,
              status: "DRAFT",
              estimateMinutes: draftTask.estimateMinutes,
              createdById: userId,
            },
            select: { id: true },
          })
          idsByIndex[index] = createdTask.id
          taskIds.push(createdTask.id)
        }
        const dependencies: { taskId: string; dependsOnId: string }[] = []
        for (const [index, draftTask] of draftTasks.entries()) {
          const taskId = idsByIndex[index]
          if (!taskId) continue
          for (const depIndex of draftTask.dependsOn) {
            const dependsOnId = idsByIndex[depIndex]
            if (dependsOnId) dependencies.push({ taskId, dependsOnId })
          }
        }
        if (dependencies.length > 0) {
          await tx.taskDependency.createMany({ data: dependencies })
        }
      }

      // Потребность склада (этап C): upsert как addProjectMaterial ядра —
      // строка на (productId, materialId) одна, повторное добавление
      // наращивает quantity. Несмапленные позиции (без materialId) и
      // неактивная номенклатура пропускаются. quantity в БД — Decimal(12,3),
      // поэтому округляем до 3 знаков.
      for (const need of product.materials ?? []) {
        if (!need.materialId || !knownIds.has(need.materialId)) continue
        const qty = Math.round(need.qty * 1000) / 1000
        if (!(qty > 0)) continue
        const line = await tx.projectMaterial.upsert({
          where: {
            productId_materialId: { productId: created.id, materialId: need.materialId },
          },
          create: {
            productId: created.id,
            materialId: need.materialId,
            quantity: qty,
            comment: `Импорт Базис: ${need.bazisName}`,
            createdById: userId,
          },
          update: { quantity: { increment: qty } },
          select: { id: true },
        })
        materialRefs.push({ id: line.id, addedQty: qty })
      }
    }

    const createdRefs: CreatedRefs = {
      productIds,
      taskIds,
      workIds,
      projectMaterialIds: materialRefs,
    }
    const batch = await tx.pluginImportBatch.create({
      data: {
        pluginId: BAZIS_IMPORT_PLUGIN_ID,
        projectId: project.id,
        fileName: fileName ?? draft.source.fileName ?? null,
        draft: draft as unknown as Prisma.InputJsonValue,
        createdRefs: createdRefs as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
      select: { id: true },
    })

    return { batchId: batch.id, productIds, numbers, workIds, taskIds, materialsCount: materialRefs.length }
  }, TX_OPTIONS)
}

// Разбор createdRefs из Json с защитой от мусора.
function parseCreatedRefs(value: unknown): CreatedRefs {
  const refs = (value ?? {}) as Partial<Record<keyof CreatedRefs, unknown>>
  const ids = (key: "productIds" | "taskIds" | "workIds"): string[] =>
    Array.isArray(refs[key]) ? refs[key].filter((v): v is string => typeof v === "string") : []
  const materialRefs: ProjectMaterialRef[] = Array.isArray(refs.projectMaterialIds)
    ? refs.projectMaterialIds.flatMap((v): ProjectMaterialRef[] => {
        // Обратная совместимость: голые string-id (старый формат) → { id }.
        if (typeof v === "string") return [{ id: v }]
        if (typeof v === "object" && v !== null) {
          const entry = v as { id?: unknown; addedQty?: unknown }
          if (typeof entry.id === "string" && entry.id !== "") {
            return [
              {
                id: entry.id,
                ...(typeof entry.addedQty === "number" && Number.isFinite(entry.addedQty)
                  ? { addedQty: entry.addedQty }
                  : {}),
              },
            ]
          }
        }
        return []
      })
    : []
  return {
    productIds: ids("productIds"),
    taskIds: ids("taskIds"),
    workIds: ids("workIds"),
    projectMaterialIds: materialRefs,
  }
}

// Откат пакета: удаляет созданные изделия, работы и задачи-черновики пакета
// и помечает батч откаченным. Блокируется, если по созданному уже пошла
// работа: задача вышла из черновика (назначили исполнителя / взяли в работу),
// по задачам есть время или начисления, на работы ссылаются чужие задачи или
// начисления, по изделиям — чужие задачи/работы, движения склада или выданные
// материалы. Там деньги и история — их откат молча терять нельзя.
export async function revertImportBatch(
  db: PrismaClient,
  batchId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const batch = await db.pluginImportBatch.findUnique({ where: { id: batchId } })
  if (!batch) return { ok: false, error: "Пакет импорта не найден" }
  if (batch.revertedAt) return { ok: false, error: "Пакет импорта уже откачен" }

  const refs = parseCreatedRefs(batch.createdRefs)
  if (refs.productIds.length === 0) {
    return { ok: false, error: "В пакете нет созданных изделий — откатывать нечего" }
  }
  const ids = refs.productIds
  const { taskIds, workIds } = refs

  const [
    batchTasks,
    foreignTasks,
    timeEntries,
    payrollByTasks,
    foreignWorks,
    worksUsedByForeignTasks,
    payrollByWorks,
    externalDependents,
    movements,
    materials,
  ] = await Promise.all([
    // Задачи пакета, вышедшие из черновика (назначили исполнителя, взяли в работу).
    taskIds.length > 0
      ? db.task.findMany({
          where: { id: { in: taskIds }, status: { not: "DRAFT" } },
          select: { title: true, status: true },
        })
      : Promise.resolve([]),
    // Задачи на изделиях пакета, созданные НЕ пакетом (вручную).
    db.task.count({ where: { productId: { in: ids }, id: { notIn: taskIds } } }),
    taskIds.length > 0
      ? db.timeEntry.count({ where: { taskId: { in: taskIds } } })
      : Promise.resolve(0),
    taskIds.length > 0
      ? db.payrollEntry.count({ where: { taskId: { in: taskIds } } })
      : Promise.resolve(0),
    // Работы на изделиях пакета, созданные НЕ пакетом (вручную).
    db.work.count({ where: { productId: { in: ids }, id: { notIn: workIds } } }),
    // Чужие задачи, ссылающиеся на работы пакета (workId).
    workIds.length > 0
      ? db.task.count({ where: { workId: { in: workIds }, id: { notIn: taskIds } } })
      : Promise.resolve(0),
    workIds.length > 0
      ? db.payrollEntry.count({ where: { workId: { in: workIds } } })
      : Promise.resolve(0),
    // Чужие задачи, зависящие от задач пакета (иначе откат молча снимет им блокировку).
    taskIds.length > 0
      ? db.taskDependency.count({
          where: { dependsOnId: { in: taskIds }, taskId: { notIn: taskIds } },
        })
      : Promise.resolve(0),
    db.stockMovement.count({ where: { productId: { in: ids } } }),
    db.projectMaterial.findMany({
      where: { productId: { in: ids } },
      select: { id: true, issuedQty: true },
    }),
  ])
  // Платежи к изделиям не привязаны (Payment.productId в модели нет) — не проверяем.

  const blockers: string[] = []
  if (batchTasks.length > 0) {
    const names = batchTasks
      .slice(0, 3)
      .map((task) => `«${task.title}»`)
      .join(", ")
    blockers.push(
      `задачи пакета уже в работе (${batchTasks.length}: ${names}${batchTasks.length > 3 ? "…" : ""})`,
    )
  }
  if (foreignTasks > 0) blockers.push(`задачи, созданные вручную (${foreignTasks})`)
  if (timeEntries > 0) blockers.push(`записи времени (${timeEntries})`)
  if (payrollByTasks > 0) blockers.push(`начисления по задачам (${payrollByTasks})`)
  if (foreignWorks > 0) blockers.push(`работы, созданные вручную (${foreignWorks})`)
  if (worksUsedByForeignTasks > 0) {
    blockers.push(`работы пакета используются другими задачами (${worksUsedByForeignTasks})`)
  }
  if (payrollByWorks > 0) blockers.push(`начисления по работам (${payrollByWorks})`)
  if (externalDependents > 0) {
    blockers.push(`от задач пакета зависят другие задачи (${externalDependents})`)
  }
  if (movements > 0) blockers.push(`движения склада (${movements})`)
  const issued = materials.filter((m) => Number(m.issuedQty) > 0)
  if (issued.length > 0) blockers.push(`материалы, уже выданные со склада (${issued.length})`)
  if (blockers.length > 0) {
    return {
      ok: false,
      error: `Откат невозможен: по изделиям пакета есть ${blockers.join(", ")}`,
    }
  }

  await db.$transaction(async (tx) => {
    if (taskIds.length > 0) {
      // Зависимости между задачами пакета (каскад сработал бы и сам,
      // но явное удаление читается и не зависит от настроек FK).
      await tx.taskDependency.deleteMany({
        where: { OR: [{ taskId: { in: taskIds } }, { dependsOnId: { in: taskIds } }] },
      })
      await tx.task.deleteMany({ where: { id: { in: taskIds } } })
    }
    if (workIds.length > 0) {
      await tx.work.deleteMany({ where: { id: { in: workIds } } })
    }
    // Потребность склада (этап C): строку, созданную импортом, удаляем;
    // строку, существовавшую раньше и наращенную инкрементом, возвращаем —
    // уменьшаем quantity на добавленное (addedQty). Выдача со склада уже
    // отсечена блокером выше (issuedQty > 0).
    for (const ref of refs.projectMaterialIds) {
      const line = await tx.projectMaterial.findUnique({
        where: { id: ref.id },
        select: { quantity: true },
      })
      if (!line) continue
      if (ref.addedQty === undefined) {
        // Старый формат refs (голый id): сколько добавлено, неизвестно — удаляем.
        await tx.projectMaterial.delete({ where: { id: ref.id } })
        continue
      }
      const remaining = Math.round((Number(line.quantity) - ref.addedQty) * 1000) / 1000
      if (remaining <= 0) {
        await tx.projectMaterial.delete({ where: { id: ref.id } })
      } else {
        await tx.projectMaterial.update({
          where: { id: ref.id },
          data: { quantity: remaining },
        })
      }
    }
    // Оставшаяся потребность с нулевой выдачей уходит каскадом вместе с изделием
    // (ProjectMaterial.productId onDelete: Cascade), история статусов — тоже.
    // Файлы отвязываются (SetNull) и остаются в проекте.
    await tx.product.deleteMany({ where: { id: { in: ids } } })
    await tx.pluginImportBatch.update({
      where: { id: batch.id },
      data: { revertedAt: new Date() },
    })
  }, TX_OPTIONS)

  return { ok: true }
}

// Пакеты импорта проекта, новые сверху (для вкладки плагина, этап A3).
export async function listImportBatches(db: PrismaClient, projectId: string) {
  return db.pluginImportBatch.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  })
}
