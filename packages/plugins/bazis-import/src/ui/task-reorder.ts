// Перестановка задач с перенумерацией dependsOn-индексов (экран
// подтверждения импорта и редактор шаблонов). dependsOn — индексы внутри
// массива задач, поэтому любой сдвиг/удаление обязан пересчитать ссылки,
// иначе зависимости «уезжают» на соседние задачи.

/** Любая задача с индексными зависимостями (DraftTask / TemplateTask). */
export interface IndexedDeps {
  dependsOn: number[]
}

/**
 * Переносит задачу с позиции from на позицию to (остальные сдвигаются)
 * и пересчитывает dependsOn всех задач. Индексы вне диапазона не трогает —
 * их отловит validateDag.
 */
export function moveTask<T extends IndexedDeps>(
  tasks: T[],
  from: number,
  to: number,
): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= tasks.length ||
    to >= tasks.length
  ) {
    return tasks
  }
  const remap = (dep: number): number => {
    if (dep === from) return to
    if (from < to) {
      // Элемент уехал вниз: интервал (from, to] сдвинулся на −1.
      if (dep > from && dep <= to) return dep - 1
    } else {
      // Элемент уехал вверх: интервал [to, from) сдвинулся на +1.
      if (dep >= to && dep < from) return dep + 1
    }
    return dep
  }
  const moved = tasks.filter((_, index) => index !== from)
  const item = tasks[from] as T
  moved.splice(to, 0, item)
  return moved.map((task) => ({
    ...task,
    dependsOn: task.dependsOn.map(remap),
  }))
}

/**
 * Удаляет задачу по индексу: ссылки на неё выкидываются,
 * ссылки на задачи после неё уменьшаются на 1.
 */
export function removeTask<T extends IndexedDeps>(tasks: T[], index: number): T[] {
  if (index < 0 || index >= tasks.length) return tasks
  return tasks
    .filter((_, taskIndex) => taskIndex !== index)
    .map((task) => ({
      ...task,
      dependsOn: task.dependsOn
        .filter((dep) => dep !== index)
        .map((dep) => (dep > index ? dep - 1 : dep)),
    }))
}
