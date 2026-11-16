import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { runApiPluginCommandInTransaction } from "@/server/plugins/command-core";
import { dispatchEvent } from "@/server/plugins/events";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { sanitizeJournalValue } from "@/server/changelog/presentation";
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
    const committed = await prisma.$transaction(tx => runApiPluginCommandInTransaction(tx, auth, manifest, commandId));
    await deliverPostCommit("plugin-command", id, [
      ...committed.eventIds.map(eventId => ({ kind: "dispatch" as const, run: () => dispatchEvent(eventId) })),
      { kind: "dispatch", run: async () => {
        for (const log of committed.logs) await logPluginRun({ pluginId: id, kind: "api", ref: `command:${commandId}`, ...log });
        await logPluginRun({ pluginId: id, kind: "api", ref: `command:${commandId}`, status: "ok", message: committed.result ?? undefined, durationMs: Date.now() - started });
      } },
    ]);
    return NextResponse.json({ ok: true, result: committed.result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PLUGIN_COMMAND_FAILED";
    const message = String(sanitizeJournalValue(error instanceof Error ? error.message : "Не удалось выполнить команду"));
    await logPluginRun({
      pluginId: id,
      kind: "api",
      ref: `command:${commandId}`,
      status: "error",
      message,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: false, error: message }, { status: code === "PLUGIN_API_FORBIDDEN" ? 403 : code === "PLUGIN_API_UNAUTHORIZED" ? 401 : code === "PLUGIN_DISABLED" ? 409 : 500 });
  }
}
