import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { buildPluginContext } from "@/server/plugins/context";
import { emitDomainEvent } from "@/server/plugins/events";
import { getManifest } from "@/server/plugins/registry";
import { logPluginRun } from "@/server/plugins/run-log";

// POST /api/v1/plugins/:id/commands/:command — запуск команды модуля. Scope: write.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; command: string }> },
) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;

  const { id, command: commandId } = await params;
  const manifest = getManifest(id);
  const command = manifest?.commands?.find((c) => c.id === commandId);
  if (!manifest || !command) {
    return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
  }
  const plugin = await prisma.plugin.findUnique({ where: { id } });
  if (!plugin?.enabled) {
    return NextResponse.json({ error: "Модуль выключен" }, { status: 409 });
  }

  const started = Date.now();
  try {
    const ctx = await buildPluginContext(id, emitDomainEvent);
    const result = await command.run(ctx);
    await logPluginRun({
      pluginId: id,
      kind: "api",
      ref: `command:${commandId}`,
      status: "ok",
      message: result ?? undefined,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: true, result: result ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logPluginRun({
      pluginId: id,
      kind: "api",
      ref: `command:${commandId}`,
      status: "error",
      message,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
