import type { ReactNode } from "react"

import type { TechData, TechPanel } from "../parser/types"

// Деталировка изделия (Product.techData) — серверный компонент, без state.
// Рендерится вкладкой «Деталировка» карточки изделия в apps/web.

function unitLabel(unit: string): string {
  if (unit === "m2") return "м²"
  if (unit === "m") return "м.пог"
  if (unit === "") return "шт"
  return unit
}

function roundQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2)
}

/** Кромки детали одной строкой: «1: 510 мм; 2: 510 мм» / «по чертежу: 800 мм». */
function edgesLabel(panel: TechPanel): { text: string; title: string } {
  const parts: string[] = []
  const titles: string[] = []
  for (const edge of panel.edges) {
    const length = `${Math.round(edge.lengthMm)} мм`
    parts.push(edge.side === "drawing" ? `по чертежу: ${length}` : `${edge.side}: ${length}`)
    titles.push(
      `${edge.side === "drawing" ? "по чертежу" : `сторона ${edge.side}`}: ${edge.name} (${length})`,
    )
  }
  return { text: parts.join("; "), title: titles.join("; ") }
}

function userPropsLabel(props: Record<string, string>): string {
  return Object.entries(props)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ")
}

const thCls = "px-2 py-1 font-medium"
const tdCls = "px-2 py-1"

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card p-4 text-card-foreground">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </section>
  )
}

export default function TechDataView({ techData }: { techData: TechData }) {
  const { panels, fittings, materials, profiles } = techData
  const hasUserProps = panels.some(
    (panel) => Object.keys(panel.userProperties).length > 0,
  )
  const isEmpty =
    panels.length === 0 &&
    fittings.length === 0 &&
    materials.length === 0 &&
    profiles.length === 0

  if (isEmpty) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Нет данных деталировки.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {panels.length > 0 ? (
        <Section title={`Деталировка (${panels.length} поз.)`}>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className={thCls}>Поз.</th>
              <th className={thCls}>Наименование</th>
              <th className={thCls}>Размеры, мм</th>
              <th className={thCls}>Толщ.</th>
              <th className={thCls}>Кол-во</th>
              <th className={thCls}>Материал</th>
              <th className={thCls}>Кромки</th>
              {hasUserProps ? <th className={thCls}>Свойства</th> : null}
            </tr>
          </thead>
          <tbody>
            {panels.map((panel, index) => {
              const edges = edgesLabel(panel)
              const props = userPropsLabel(panel.userProperties)
              return (
                <tr
                  key={`${panel.position}-${index}`}
                  className="border-b last:border-0"
                >
                  <td className={`${tdCls} whitespace-nowrap text-muted-foreground`}>
                    {panel.position || index + 1}
                  </td>
                  <td className={tdCls}>{panel.name}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {Math.round(panel.finishedLengthMm)}×
                    {Math.round(panel.finishedWidthMm)}
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {panel.thicknessMm}
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {roundQty(panel.qty)}
                  </td>
                  <td className={tdCls}>{panel.material?.name ?? "—"}</td>
                  <td className={tdCls} title={edges.title || undefined}>
                    {edges.text || "—"}
                  </td>
                  {hasUserProps ? (
                    <td
                      className={`${tdCls} max-w-48 truncate text-muted-foreground`}
                      title={props || undefined}
                    >
                      {props || "—"}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </Section>
      ) : null}

      {fittings.length > 0 ? (
        <Section title={`Фурнитура (${fittings.length} поз.)`}>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className={thCls}>Наименование</th>
              <th className={thCls}>Код</th>
              <th className={thCls}>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {fittings.map((fitting, index) => (
              <tr
                key={`${fitting.name}|${fitting.code}|${index}`}
                className="border-b last:border-0"
              >
                <td className={tdCls}>{fitting.name}</td>
                <td className={`${tdCls} text-muted-foreground`}>
                  {fitting.code || "—"}
                </td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  {roundQty(fitting.qty)}
                </td>
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {materials.length > 0 ? (
        <Section title="Материалы">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className={thCls}>Наименование</th>
              <th className={thCls}>Кол-во</th>
              <th className={thCls}>Ед.</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((material, index) => (
              <tr
                key={`${material.name}|${material.unit}|${index}`}
                className="border-b last:border-0"
              >
                <td className={tdCls}>{material.name}</td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  {material.unit === "m2"
                    ? material.qty.toFixed(2)
                    : material.unit === "m"
                      ? material.qty.toFixed(1)
                      : roundQty(material.qty)}
                </td>
                <td className={`${tdCls} text-muted-foreground`}>
                  {unitLabel(material.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {profiles.length > 0 ? (
        <Section title={`Профили (${profiles.length} поз.)`}>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className={thCls}>Наименование</th>
              <th className={thCls}>Длина, мм</th>
              <th className={thCls}>Кол-во</th>
              <th className={thCls}>Материал</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile, index) => (
              <tr
                key={`${profile.name}|${profile.code}|${index}`}
                className="border-b last:border-0"
              >
                <td className={tdCls}>{profile.name}</td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  {Math.round(profile.lengthMm)}
                </td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  {roundQty(profile.qty)}
                </td>
                <td className={tdCls}>{profile.material?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}
    </div>
  )
}
