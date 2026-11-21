import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isCrmPage, resolvePageBack, visitPage } from "../src/lib/page-navigation";
import { resolveProductReturn } from "../src/lib/product-return-navigation";
import { resolveProjectReturn } from "../src/lib/project-return-navigation";
import inventory from "./page-header-routes.json";

test("фильтры обновляют один экран, вложенный экран ведёт к родителю", () => {
  const first = visitPage([], { href: "/warehouse" });
  const list = visitPage(first, { href: "/projects?view=kanban" });
  const filtered = visitPage(list, { href: "/projects?view=table&q=123" });
  assert.deepEqual(filtered.map(visit => visit.href), ["/warehouse", "/projects?view=table&q=123"]);
  assert.equal(resolvePageBack("/projects", "/", filtered[0].href)?.href, "/warehouse");
  assert.equal(resolvePageBack("/finance/accounts/report", "/", filtered[1].href)?.href, "/finance/accounts");
});

test("старт роли скрывает стрелку до перехода и изолирует рабочие адреса", () => {
  for (const home of ["/", "/products", "/warehouse", "/finance", "/my"]) {
    assert.equal(resolvePageBack(home, home, null), null);
    assert.equal(resolvePageBack("/notifications", home, null)?.href, home);
    assert.equal(resolvePageBack(home, home, "/notifications")?.href, "/notifications");
  }
  for (const href of ["https://example.com/", "//example.com", "/api/auth", "/finance/../login", "/login", "/financial", "/products-other"]) {
    assert.equal(isCrmPage(href), false);
    assert.equal(resolvePageBack("/warehouse", "/", href)?.href, "/");
  }
});

const src = fileURLToPath(new URL("../src/", import.meta.url));
const app = resolve(src, "app/(app)");
const header = resolve(src, "components/page-header");
const files = readdirSync(app, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name === "page.tsx")
  .map(entry => resolve(entry.parentPath, entry.name));
const pages = new Map(files.map(file => ["/" + relative(app, dirname(file)).split(sep).join("/"), file]));
const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);

function renderedImports(file: string, expected: string) {
  const source = parse(file);
  const tags = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const target = specifier.startsWith("@/") ? resolve(src, specifier.slice(2)) : resolve(dirname(file), specifier);
    if (target !== expected || statement.importClause?.isTypeOnly) continue;
    const clause = statement.importClause;
    if (clause?.name) tags.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements) if (!binding.isTypeOnly) tags.add(binding.name.text);
    }
  }
  let count = 0;
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tags.has(node.tagName.getText(source))) count++;
    ts.forEachChild(node, visit);
  }
  visit(source);
  return count;
}

test("карта содержит все рабочие страницы и редиректы", () => {
  assert.equal(pages.size, files.length);
  assert.deepEqual([...pages.keys()].sort(), Object.keys(inventory).sort());
});

for (const [path, route] of Object.entries(inventory)) {
  test(path, () => {
    const page = pages.get(path);
    assert.ok(page);
    if ("redirect" in route) {
      const source = parse(page);
      const entry = source.statements.find(ts.isFunctionDeclaration);
      const last = entry?.body?.statements.at(-1);
      assert.ok(last && ts.isExpressionStatement(last) && ts.isCallExpression(last.expression));
      assert.equal(last.expression.expression.getText(source), "redirect");
      const url = last.expression.arguments[0];
      if (ts.isStringLiteral(url)) assert.equal(url.text, route.redirect);
      else {
        assert.ok(ts.isBinaryExpression(url) && url.operatorToken.kind === ts.SyntaxKind.PlusToken);
        assert.ok(ts.isStringLiteral(url.left) && ts.isCallExpression(url.right));
        const id = url.right.arguments[0];
        assert.ok(ts.isPropertyAccessExpression(id));
        assert.equal(url.right.expression.getText(source), "encodeURIComponent");
        assert.equal(url.left.text + "[" + id.name.text + "]", route.redirect);
      }
      return;
    }

    const chain = "views" in route ? route.views.map(view => view.startsWith("@/") ? resolve(src, view.slice(2)) : resolve(app, view)) : [];
    let owner = page;
    for (const view of chain) {
      assert.ok(renderedImports(owner, view) > 0, "Страница должна подключать указанное представление");
      owner = view + ".tsx";
    }
    assert.equal(renderedImports(owner, header), 1, "Представление должно подключать общий заголовок один раз");

    const explicit = path === "/products/[id]" ? resolveProductReturn(undefined, "fixture-project")
      : path === "/projects/[id]" ? { href: resolveProjectReturn(undefined), label: "К списку проектов" } : undefined;
    const actual = resolvePageBack(path.replace("[id]", "fixture-id"), "/", null, explicit);
    assert.equal(actual?.href ?? null, route.back?.replace("[projectId]", "fixture-project") ?? null);
  });
}
