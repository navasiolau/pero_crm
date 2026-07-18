import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { PluginSlot } from "@/components/plugins/plugin-slot"
import { RecentProjects } from "@/components/recent-projects"
import { SectionCards } from "@/components/section-cards"

export default async function DashboardPage() {
  const session = await auth()

  // Работник и монтажник после входа сразу попадают на «Мои задачи» (§4 плана)
  if (session?.user.role === "WORKER" || session?.user.role === "MOUNTER") {
    redirect("/my")
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <SectionCards />
      {/* Слот виджетов плагинов (§14): пусто, пока ни один модуль не включён */}
      <PluginSlot
        slot="dashboard.widget"
        props={{ role: session?.user.role ?? "" }}
      />
      <ChartAreaInteractive />
      <RecentProjects />
      <p className="text-xs text-muted-foreground">
        Показатели выше — демо-данные для проверки интерфейса.
      </p>
    </div>
  )
}
