"use client"

import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Демо-показатели до подключения реальных данных (фазы 2+)
const cards = [
  {
    title: "Проекты в работе",
    value: "12",
    trend: "+2",
    trendUp: true,
    summary: "Растёт загрузка производства",
    note: "По сравнению с прошлым месяцем",
  },
  {
    title: "Задачи на сегодня",
    value: "8",
    trend: "-3",
    trendUp: false,
    summary: "Меньше, чем вчера",
    note: "Учитываются все цеха",
  },
  {
    title: "Выручка месяца",
    value: "4 280 000 ₽",
    trend: "+12,5%",
    trendUp: true,
    summary: "Рост к прошлому месяцу",
    note: "Оплаченные заказы",
  },
  {
    title: "Активные сотрудники",
    value: "23",
    trend: "+2",
    trendUp: true,
    summary: "Вышли на смену сегодня",
    note: "Цех и монтажные бригады",
  },
]

export function SectionCards() {
  return (
    <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {cards.map((card) => (
        <Card key={card.title} className="@container/card">
          <CardHeader>
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                {card.trendUp ? <TrendingUpIcon /> : <TrendingDownIcon />}
                {card.trend}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {card.summary}{" "}
              {card.trendUp ? (
                <TrendingUpIcon className="size-4" />
              ) : (
                <TrendingDownIcon className="size-4" />
              )}
            </div>
            <div className="text-muted-foreground">{card.note}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
