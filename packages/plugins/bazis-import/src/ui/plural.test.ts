import { describe, expect, it } from "vitest"

import { plural } from "./plural"

const forms = ["изделие", "изделия", "изделий"] as const
const p = (n: number): string => plural(n, forms[0], forms[1], forms[2])

describe("plural", () => {
  it("1 → one", () => {
    expect(p(1)).toBe("изделие")
    expect(p(21)).toBe("изделие")
    expect(p(101)).toBe("изделие")
  })

  it("2–4 → few", () => {
    expect(p(2)).toBe("изделия")
    expect(p(3)).toBe("изделия")
    expect(p(4)).toBe("изделия")
    expect(p(23)).toBe("изделия")
  })

  it("5+ → many", () => {
    expect(p(0)).toBe("изделий")
    expect(p(5)).toBe("изделий")
    expect(p(9)).toBe("изделий")
    expect(p(25)).toBe("изделий")
  })

  it("11–14 → many (исключение)", () => {
    expect(p(11)).toBe("изделий")
    expect(p(12)).toBe("изделий")
    expect(p(13)).toBe("изделий")
    expect(p(14)).toBe("изделий")
    expect(p(111)).toBe("изделий")
  })
})
