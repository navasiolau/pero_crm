import {taskWorkspaceEligibility} from '@/server/tasks/workspace-contract';
import {liveProjectWhere,liveProductWhere,liveChildWhere} from "@/server/access/live-entities";
import { projectTotal as calculateProjectTotal } from "@/lib/product-quantity";
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { PluginSlot } from "@/components/plugins/plugin-slot"
import { RecentProjects } from "@/components/recent-projects"
import { SectionCards } from "@/components/section-cards"
import { formatAmount } from "@/lib/format"
import { displayClientName } from "@/lib/labels"
import { homePathForRoles } from "@/lib/home-route"
import { OFFICE_ROLES, hasAnyRole, primaryRole } from "@/lib/roles"
import { stageLabels, stageStyles } from "@/lib/stages"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  // Проверяем доступ до запросов статистики, в том числе без middleware.
  const roles = session.user.roles
  const homePath = homePathForRoles(roles)
  if (homePath !== "/") {
    redirect(homePath)
  }

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [inWork, tasksToday, activeUsers, recent] = await Promise.all([
    prisma.project.count({ where: { ...liveProjectWhere,stage: "IN_WORK" } }),
    prisma.task.count({
      where: { AND:[liveChildWhere,await taskWorkspaceEligibility(prisma)],status: { not: "DONE" }, dueAt: { lte: todayEnd } },
    }),
    prisma.user.count({ where: { active: true } }),
    prisma.project.findMany({
      where:liveProjectWhere,
      include: {
        client: { select: { name: true, lastName: true, middleName: true } },
        products: { where:liveProductWhere,select: { expectedPrice: true, quantity: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const showAmount = hasAnyRole(roles, OFFICE_ROLES);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <SectionCards
        cards={[
          {
            title: "Проекты в работе",
            value: String(inWork),
            summary: "Этап «В работе»",
            note: "Проектирование, производство, монтаж",
          },
          {
            title: "Задачи на сегодня",
            value: String(tasksToday),
            summary: "Активных со сроком",
            note: "По всем проектам организации",
          },
          {
            title: "Выручка месяца",
            value: "—",
            summary: "Платежи — фаза 5",
            note: "Раздел финансов впереди",
          },
          {
            title: "Активные сотрудники",
            value: String(activeUsers),
            summary: "Учётные записи",
            note: "Цех и монтажные бригады",
          },
        ]}
      />
      {/* Слот виджетов плагинов (§14): пусто, пока ни один модуль не включён */}
      <PluginSlot
        slot="dashboard.widget"
        props={{ role: primaryRole(roles) }}
      />
      <ChartAreaInteractive />
      <RecentProjects
        projects={recent.map((project) => {
          // Сумма проекта = Σ цен изделий + доставка/выгрузка/монтаж
          const totalPrice =
            calculateProjectTotal(project.products, project);
          return {
            id: project.id,
            number: project.number,
            client: displayClientName(project.client),
            product: project.title,
            status: stageLabels[project.stage],
            statusClass: stageStyles[project.stage].badge,
            sum: showAmount
              ? formatAmount(
                  totalPrice > 0 ? String(totalPrice) : null,
                  project.currency,
                )
              : "—",
          };
        })}
      />
      <p className="text-xs text-muted-foreground">
        График — демо-данные; реальная динамика появится в следующих фазах.
      </p>
    </div>
  )
}
