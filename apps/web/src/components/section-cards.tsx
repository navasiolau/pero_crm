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

export interface StatCard {
  title: string
  value: string
  trend?: string
  trendUp?: boolean
  summary: string
  note: string
}

// Stat-карточки дашборда (данные приходят с сервера)
export function SectionCards({ cards }: { cards: StatCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="@container/card">
          <CardHeader>
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
            {card.trend ? (
              <CardAction>
                <Badge variant="outline">
                  {card.trendUp ? <TrendingUpIcon /> : <TrendingDownIcon />}
                  {card.trend}
                </Badge>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {card.summary}
              {card.trendUp === undefined ? null : card.trendUp ? (
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
