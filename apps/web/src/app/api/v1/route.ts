import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";

// GET /api/v1 — информация о сервисе и включённых модулях.
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (isErrorResponse(auth)) return auth;

  const plugins = await prisma.plugin.findMany({
    where: { enabled: true },
    select: { id: true, version: true, apiVersion: true },
  });
  return NextResponse.json({
    service: "PERO CRM",
    api: "v1",
    plugins,
  });
}
