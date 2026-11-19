import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import type { Prisma } from "@prisma/client";
import { assertPluginAuditEntry, assertPluginEventType, pluginReadDatabase } from "../src/server/plugins/read-database";

test("plugin read handle grants only declared bounded project projection", async () => {
  const calls: unknown[] = [];
  const project = {
    findFirst: async (input: unknown) => { calls.push(input); return null; },
    findMany: async (input: unknown) => { calls.push(input); return []; },
  } as unknown as Prisma.TransactionClient["project"];
  assert.deepEqual(pluginReadDatabase({ project }, []), {});
  const scoped = pluginReadDatabase({ project }, ["projects:read", "projects:write"]);
  assert.ok(Object.isFrozen(scoped) && Object.isFrozen(scoped.project));
  assert.deepEqual(Object.keys(scoped.project ?? {}).sort(), ["findMany", "findUnique"]);
  assert.ok(!("$queryRaw" in scoped) && !("$transaction" in scoped));
  await scoped.project?.findUnique({ where: { id: "project-1" } });
  await scoped.project?.findMany({ take: 99999 });
  assert.deepEqual(calls, [
    { where: { deletedAt: null, id: "project-1" }, select: { id: true, number: true, title: true } },
    { where: { deletedAt: null }, select: { id: true, number: true, title: true }, orderBy: { id: "asc" }, take: 100 },
  ]);
});

test("plugin journal and event channels are scoped to the calling extension", () => {
  assert.doesNotThrow(() => assertPluginAuditEntry("demo", { entity: "plugin", entityId: "demo", action: "command.ping" }));
  assert.doesNotThrow(() => assertPluginEventType("demo", "demo.ping"));
  assert.throws(() => assertPluginAuditEntry("demo", { entity: "project", entityId: "p1", action: "update" }), /PLUGIN_AUDIT_SCOPE/);
  assert.throws(() => assertPluginAuditEntry("demo", { entity: "plugin", entityId: "foreign", action: "update" }), /PLUGIN_AUDIT_SCOPE/);
  assert.throws(() => assertPluginEventType("demo", "files.storage.delete"), /PLUGIN_EVENT_SCOPE/);
});

test("bundled plugin source reaches host data only through the public SDK", () => {
  const plugins = fileURLToPath(new URL("../../../packages/plugins/", import.meta.url));
  for (const plugin of readdirSync(plugins, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const root = path.join(plugins, plugin.name);
    inspect(root);
    function inspect(folder: string): void {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const file = path.join(folder, entry.name);
        assert.ok(!entry.isSymbolicLink(), file);
        if (entry.isDirectory()) inspect(file);
        if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
        const permit = (value: ts.Node | undefined) => {
          assert.ok(value && ts.isStringLiteral(value), `Dynamic host import in ${file}`);
          if (value.text === "@pero/plugin-sdk" || value.text === "react") return;
          assert.ok(value.text.startsWith("."), `Unexpected plugin dependency ${value.text}`);
          const relative = path.relative(root, path.resolve(folder, value.text));
          assert.ok(relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative), file);
        };
        function visit(node: ts.Node): void {
          if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) permit(node.moduleSpecifier);
          if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) permit(node.moduleReference.expression);
          if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === "require"))) permit(node.arguments[0]);
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
});
