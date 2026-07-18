"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

// Демо-ряды за последние 90 дней: заказы и выпуск изделий (фаза 2 заменит реальными)
const chartData = Array.from({ length: 90 }, (_, index) => {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (89 - index))
  const orders = Math.round(
    140 + 90 * Math.sin(index / 6.5) + 45 * Math.cos(index / 2.7) + index * 0.9,
  )
  const production = Math.round(
    110 + 70 * Math.sin(index / 8 + 1.4) + 40 * Math.cos(index / 3.4) + index * 0.7,
  )
  return {
    date: date.toISOString().slice(0, 10),
    orders: Math.max(orders, 20),
    production: Math.max(production, 15),
  }
})

const chartConfig = {
  orders: {
    label: "Заказы",
    color: "var(--chart-1)",
  },
  production: {
    label: "Выпуск изделий",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

const timeRanges = [
  { value: "90d", label: "3 месяца", days: 90 },
  { value: "30d", label: "30 дней", days: 30 },
  { value: "7d", label: "7 дней", days: 7 },
]

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  })
}

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const filteredData = React.useMemo(() => {
    const range = timeRanges.find((item) => item.value === timeRange)
    return chartData.slice(-(range?.days ?? 90))
  }, [timeRange])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Заказы и выпуск</CardTitle>
        <CardDescription>
          Демо-данные — реальная динамика появится в фазе 2
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value) => {
              setTimeRange(value[0] ?? "90d")
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            {timeRanges.map((range) => (
              <ToggleGroupItem key={range.value} value={range.value}>
                {range.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            value={timeRange}
            onValueChange={(value) => {
              if (value !== null) {
                setTimeRange(value)
              }
            }}
          >
            <SelectTrigger
              className="flex w-36 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Период"
            >
              <SelectValue placeholder="3 месяца">
                {timeRanges.find((range) => range.value === timeRange)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {timeRanges.map((range) => (
                <SelectItem
                  key={range.value}
                  value={range.value}
                  className="rounded-lg"
                >
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillOrders" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-orders)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-orders)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillProduction" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-production)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-production)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatDate}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatDate(String(value))}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="production"
              type="natural"
              fill="url(#fillProduction)"
              stroke="var(--color-production)"
              stackId="a"
            />
            <Area
              dataKey="orders"
              type="natural"
              fill="url(#fillOrders)"
              stroke="var(--color-orders)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
