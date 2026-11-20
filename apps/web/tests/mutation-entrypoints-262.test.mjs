import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const exportAt = process.argv.indexOf("--export-inventory");
const root = exportAt >= 0 && process.argv[exportAt + 1]
  ? resolve(process.argv[exportAt + 1])
  : resolve(import.meta.dirname, "..");
const methods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const models = new Set([...readFileSync(resolve(root, "prisma/schema.prisma"), "utf8").matchAll(/^model (\w+)/gm)]
  .map(([, name]) => name[0].toLowerCase() + name.slice(1)));
function* sourceFiles(relative = "") {
  for (const dir of readdirSync(resolve(root, "src", relative), { withFileTypes: true })) {
    const path = relative ? relative + "/" + dir.name : dir.name;
    if (dir.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(dir.name)) yield path;
  }
}

function names(binding) {
  if (ts.isIdentifier(binding)) return [binding.text];
  return binding.elements.flatMap(element => ts.isBindingElement(element) ? names(element.name) : []);
}

function member(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression))
    return expression.argumentExpression.text;
}

function parse(path) {
  const file = ts.createSourceFile(path, readFileSync(resolve(root, "src", path), "utf8"), ts.ScriptTarget.Latest, true);
  const server = file.statements.some(statement => ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) && statement.expression.text === "use server");
  const route = path.startsWith("app/api/") && path.endsWith("/route.ts");
  const exports = new Set();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) exports.add(specifier.name.text);
    } else if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(statement) && statement.name) exports.add(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const name of names(declaration.name)) exports.add(name);
        }
      }
    }
  }
  let destructive = 0;
  function visit(node, modelWrite = false, rawSql = false) {
    if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
      const access = node.expression;
      if (["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe", "query"].includes(member(access))) rawSql = true;
      if (models.has(member(access.expression))) {
        modelWrite = ["create", "update", "upsert", "createMany", "updateMany", "updateManyAndReturn"].includes(member(access));
        if (["delete", "deleteMany"].includes(member(access))) destructive++;
      }
    }
    if (ts.isTaggedTemplateExpression(node) && ["$executeRaw", "$queryRaw", "sql"].includes(member(node.tag))) rawSql = true;
    if (modelWrite && (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        ["delete", "deleteMany"].includes(node.name.text)) destructive++;
    if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) &&
        (rawSql ? /\bDELETE\s+FROM\b|\bTRUNCATE\s+/i : /\bDELETE\s+FROM\b|\bTRUNCATE\s+TABLE\b/i).test(node.text)) destructive++;
    ts.forEachChild(node, child => visit(child, modelWrite, rawSql));
  }
  visit(file);
  return { destructive, names: [...exports].filter(name => server || (route && methods.has(name))).sort() };
}

const inventory = new Map([...sourceFiles()].map(path => [path, parse(path)]));
if (exportAt >= 0) {
  console.log(JSON.stringify(Object.fromEntries([...inventory].filter(([, result]) => result.names.length)
    .map(([path, result]) => [path, result.names]))));
} else {
  test("HTTP writers and Server Actions are inventoried and contain no new hard delete", () => {
    const allowed = JSON.parse(readFileSync(new URL("./fixtures/mutation-entrypoints-262.json", import.meta.url), "utf8"));
    const unknown = [], destructive = [];
    for (const [path, result] of inventory) {
      for (const name of result.names) if (!allowed[path]?.includes(name)) unknown.push(path + "#" + name);
      if (result.destructive) destructive.push(path);
    }
    assert.deepEqual(unknown, [], "Проверьте корень операции и обратимость, затем обновите инвентарь");
    assert.deepEqual(destructive, [], "Используйте доменное мягкое удаление");
  });
}
