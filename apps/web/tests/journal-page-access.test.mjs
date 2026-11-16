import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(web, "package.json"));

test("actual journal page checks ADMIN before rendering and passes only initial filters", async () => {
  const boundaries = {
    "journal-page-fixture": "export const state={session:null,renders:0,props:null};",
    "@/auth": "import{state}from'journal-page-fixture';export const auth=async()=>state.session;",
    "next/navigation": "export function redirect(){throw Error('LOGIN_REQUIRED')}",
    "@/components/journal/journal": "import{state}from'journal-page-fixture';export function Journal(props){state.renders++;state.props=props;return <div data-journal-placeholder/>}",
  };
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const built = await build({ stdin: { contents: "export {default as page} from '@/app/(app)/changelog/page';export {state} from 'journal-page-fixture';", loader: "tsx", resolveDir: web },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), logLevel: "silent",
    plugins: [{ name: "journal-page-session", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(boundaries, args.path) ? { path: args.path, namespace: "journal-page-session" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "journal-page-session" }, args => ({ contents: boundaries[args.path], loader: "tsx", resolveDir: web }));
    } }],
  });
  const filename = path.join(web, "tests", "journal-page-access-fixture.cjs");
  const loaded = new Module(filename);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(built.outputFiles[0].text, filename);
  const { page, state } = loaded.exports;
  await assert.rejects(() => page({ searchParams: Promise.resolve({}) }), /LOGIN_REQUIRED/);
  for (const roles of [["DIRECTOR"], ["MANAGER"], ["ENGINEER"], ["ACCOUNTANT"], ["PROCUREMENT"], ["WORKER"], ["MOUNTER"], ["WORK_COORDINATOR"], ["WORK_COORDINATOR", "WORKER"], ["MANAGER", "ENGINEER"], ["ACCOUNTANT", "PROCUREMENT"], []]) {
    state.session = { user: { id: "actor", roles } };
    await assert.rejects(() => page({ searchParams: Promise.resolve({ q: "secret" }) }), /Недостаточно прав/);
  }
  assert.equal(state.renders, 0);
  state.session = { user: { id: "actor", roles: ["ADMIN"] } };
  const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ q: "Полка", actorId: "archived-user", entity: "product", page: "2", pageSize: "50", sort: "actor", dir: "asc" }) }));
  assert.match(html, /Журнал изменений/);
  assert.equal(state.renders, 1);
  assert.deepEqual(state.props.initialQuery, { q: "Полка", actorId: "archived-user", entity: "product", from: undefined, to: undefined, page: 2, pageSize: 50, sort: "actor", dir: "asc" });
  assert.deepEqual(Object.keys(state.props), ["initialQuery"]);
});
