import { Construction, type LucideIcon } from "lucide-react"

export function StubPage({
  title,
  description = "Раздел появится в следующих фазах",
  icon: Icon = Construction,
}: {
  title: string
  description?: string
  icon?: LucideIcon
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-8" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
