import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { displayClientName } from "@/lib/labels";

const OFFICE = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER"];

// GET /api/search?q=… — глобальный поиск (omnisearch): проекты, задачи, клиенты.
// Видимость как в разделах (§4): работник/монтажник — только своё.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const role = session.user.role;
  const office = OFFICE.includes(role);

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ projects: [], tasks: [], clients: [] });
  }
  const contains = { contains: q, mode: "insensitive" as const };

  const projectWhere = {
    AND: [
      office ? {} : { tasks: { some: { assigneeId: session.user.id } } },
      {
        OR: [
          { number: contains },
          { title: contains },
          { client: { name: contains } },
          { client: { lastName: contains } },
          { client: { middleName: contains } },
        ],
      },
    ],
  };

  const [projects, tasks, clients] = await Promise.all([
    prisma.project.findMany({
      where: projectWhere,
      include: { client: { select: { name: true, lastName: true, middleName: true } } },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.task.findMany({
      where: {
        AND: [
          office ? {} : { assigneeId: session.user.id },
          { OR: [{ title: contains }, { project: { number: contains } }] },
        ],
      },
      include: {
        project: { select: { id: true, number: true, title: true } },
        assignee: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    office
      ? prisma.client.findMany({
          where: {
            OR: [
              { name: contains },
              { lastName: contains },
              { middleName: contains },
              { phone: contains },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: 4,
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    projects: projects.map((project) => ({
      id: project.id,
      number: project.number,
      title: project.title,
      client: displayClientName(project.client),
      stage: project.stage,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      projectId: task.project.id,
      projectNumber: task.project.number,
      projectTitle: task.project.title,
      assignee: task.assignee?.name ?? null,
    })),
    clients: clients.map((client) => ({
      id: client.id,
      name: displayClientName(client),
      phone: client.phone,
    })),
  });
}
