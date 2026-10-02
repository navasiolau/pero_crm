"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { CardNumber } from "@/components/card-number"
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
import { cn } from "@/lib/utils"

export interface RecentProjectRow {
  id: string
  number: string
  client: string
  product: string
  status: string
  statusClass: string
  sum: string
}

// Последние проекты на дашборде (реальные данные с фазы 2)
export function RecentProjects({ projects }: { projects: RecentProjectRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Последние проекты</CardTitle>
        <CardDescription>Свежие карточки из воронки</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Номер</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Заказ</TableHead>
              <TableHead>Этап</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/projects/${project.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    <CardNumber>{project.number}</CardNumber>
                  </Link>
                </TableCell>
                <TableCell>{project.client}</TableCell>
                <TableCell>{project.product}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn("border-transparent", project.statusClass)}
                  >
                    {project.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{project.sum}</TableCell>
              </TableRow>
            ))}
            {projects.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  Проектов пока нет — создайте первый в разделе «Проекты»
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
