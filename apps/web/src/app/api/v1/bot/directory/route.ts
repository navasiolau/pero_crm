import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { displayClientName } from "@/lib/labels";
import { STAGES } from "@/lib/stages";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { listManagers } from "@/server/projects/queries";
import {
  isActorError,
  requireBotManager,
  resolveBotActor,
} from "@/server/telegram/bot-api";

// GET /api/v1/bot/directory?type=clients|managers|cash|articles|stages[&q=]
// — справочники для диалогов бота (кнопки-выборы). Scope: read.
export async function GET(request: Request) {
  const auth = await authenticate(request, "read");
  if (isErrorResponse(auth)) return auth;
  const actor = await resolveBotActor(request);
  if (isActorError(actor)) return actor;
  const gate = requireBotManager(actor);
  if (gate) return gate;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";

  switch (type) {
    case "clients": {
      const clients = await prisma.client.findMany({
        where: q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
              ],
            }
          : undefined,
        select: { id: true, name: true, lastName: true, middleName: true, phone: true },
        orderBy: [{ lastName: "asc" }, { name: "asc" }],
        take: 8,
      });
      return NextResponse.json({
        ok: true,
        items: clients.map((client) => ({
          id: client.id,
          label: displayClientName(client),
          phone: client.phone,
        })),
      });
    }
    case "managers": {
      const managers = await listManagers();
      return NextResponse.json({
        ok: true,
        items: managers.map((manager) => ({ id: manager.id, label: manager.name })),
      });
    }
    case "cash": {
      const accounts = await prisma.cashAccount.findMany({
        where: { active: true },
        select: { id: true, name: true, currency: true },
        orderBy: { name: "asc" },
      });
      return NextResponse.json({ ok: true, items: accounts });
    }
    case "articles": {
      const articles = await prisma.expenseArticle.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return NextResponse.json({
        ok: true,
        items: articles.map((article) => ({ id: article.id, label: article.name })),
      });
    }
    case "stages": {
      return NextResponse.json({
        ok: true,
        items: STAGES.map((stage) => ({ id: stage.id, label: stage.label })),
      });
    }
    default:
      return NextResponse.json(
        { ok: false, error: "Неизвестный тип справочника" },
        { status: 400 },
      );
  }
}
