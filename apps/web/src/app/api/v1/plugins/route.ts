import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";

// GET /api/v1/plugins — список модулей и их статус. Scope: read.
export async function GET(request: Request) {
  const auth = await authenticate(request, "read");
  if (isErrorResponse(auth)) return auth;

  const plugins = await prisma.plugin.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      version: true,
      apiVersion: true,
      enabled: true,
      permissions: true,
    },
  });
  return NextResponse.json({ plugins });
}
