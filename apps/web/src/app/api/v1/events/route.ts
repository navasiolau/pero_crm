import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";

// GET /api/v1/events — последние доменные события шины. Scope: read.
export async function GET(request: Request) {
  const auth = await authenticate(request, "read");
  if (isErrorResponse(auth)) return auth;

  const events = await prisma.domainEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      type: true,
      payload: true,
      actor: true,
      createdAt: true,
      processedAt: true,
      attempts: true,
      lastError: true,
    },
  });
  return NextResponse.json({ events });
}
