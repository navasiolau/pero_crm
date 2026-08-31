import { describe, expect, it } from "vitest"

import { moveTask, removeTask } from "./task-reorder"

interface Task {
  title: string
  dependsOn: number[]
}

const tasks = (...specs: [string, number[]][]): Task[] =>
  specs.map(([title, dependsOn]) => ({ title, dependsOn }))

describe("moveTask", () => {
  it("перенос вниз пересчитывает зависимости", () => {
    // [A, B, C, D], B→позицию 3: [A, C, D, B]
    const result = moveTask(
      tasks(["A", []], ["B", [0]], ["C", [1]], ["D", [2]]),
      1,
      3,
    )
    expect(result.map((task) => task.title)).toEqual(["A", "C", "D", "B"])
    // C зависела от B (1→3), D зависела от C (2→1), B — от A (0 не меняется)
    expect(result.map((task) => task.dependsOn)).toEqual([
      [],
      [3],
      [1],
      [0],
    ])
  })

  it("перенос вверх пересчитывает зависимости", () => {
    // [A, B, C, D], D→позицию 1: [A, D, B, C]
    const result = moveTask(
      tasks(["A", []], ["B", [0]], ["C", [1]], ["D", [2]]),
      3,
      1,
    )
    expect(result.map((task) => task.title)).toEqual(["A", "D", "B", "C"])
    // D зависела от C (2→3), C зависела от B (1→2), B — от A (0)
    expect(result.map((task) => task.dependsOn)).toEqual([
      [],
      [3],
      [0],
      [2],
    ])
  })

  it("соседний сдвиг на одну позицию", () => {
    const result = moveTask(tasks(["A", []], ["B", [0]], ["C", [1]]), 0, 1)
    expect(result.map((task) => task.title)).toEqual(["B", "A", "C"])
    // B зависела от A (0→1), A ни от кого, C зависела от B (1→0)
    expect(result.map((task) => task.dependsOn)).toEqual([[1], [], [0]])
  })

  it("noop: те же индексы или вне диапазона — массив без изменений", () => {
    const source = tasks(["A", []], ["B", [0]])
    expect(moveTask(source, 1, 1)).toBe(source)
    expect(moveTask(source, -1, 0)).toBe(source)
    expect(moveTask(source, 0, 5)).toBe(source)
  })

  it("не трогает зависимости вне диапазона (их отловит validateDag)", () => {
    const result = moveTask(tasks(["A", [7]], ["B", []]), 0, 1)
    expect(result[1]?.dependsOn).toEqual([7])
  })
})

describe("removeTask", () => {
  it("удаляет задачу, выкидывает ссылки на неё и сдвигает остальные", () => {
    // [A, B, C, D] −B: [A, C, D]
    const result = removeTask(
      tasks(["A", []], ["B", [0]], ["C", [1]], ["D", [0, 2]]),
      1,
    )
    expect(result.map((task) => task.title)).toEqual(["A", "C", "D"])
    // C зависела от B — ссылка выкинута; D: 0 остаётся, 2→1
    expect(result.map((task) => task.dependsOn)).toEqual([[], [], [0, 1]])
  })

  it("удаление первой задачи", () => {
    const result = removeTask(tasks(["A", []], ["B", [0]], ["C", [0, 1]]), 0)
    expect(result.map((task) => task.title)).toEqual(["B", "C"])
    expect(result.map((task) => task.dependsOn)).toEqual([[], [0]])
  })

  it("индекс вне диапазона — массив без изменений", () => {
    const source = tasks(["A", []])
    expect(removeTask(source, 3)).toBe(source)
  })
})
