"use client"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Демо-строки до появления реальных проектов (фаза 2)
const projects = [
  {
    id: "П-2026-014",
    client: "Иванова Анна",
    product: "Кухня «Модерн»",
    status: "В производстве",
    sum: "385 000 ₽",
  },
  {
    id: "П-2026-013",
    client: "Петров Сергей",
    product: "Шкаф-купе",
    status: "Монтаж",
    sum: "142 000 ₽",
  },
  {
    id: "П-2026-012",
    client: "ООО «Альфа»",
    product: "Офисная мебель",
    status: "Замер",
    sum: "96 500 ₽",
  },
  {
    id: "П-2026-011",
    client: "Сидорова Елена",
    product: "Гардеробная",
    status: "Завершён",
    sum: "210 000 ₽",
  },
]

const statusVariants: Record<string, "default" | "secondary" | "outline"> = {
  "В производстве": "default",
  "Монтаж": "secondary",
  "Замер": "outline",
  "Завершён": "outline",
}

export function RecentProjects() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Последние проекты</CardTitle>
        <CardDescription>Демо-данные — реальный список появится в фазе 2</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Номер</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead className="hidden md:table-cell">Изделие</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell className="font-medium">{project.id}</TableCell>
                <TableCell>{project.client}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {project.product}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariants[project.status] ?? "outline"}>
                    {project.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {project.sum}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
