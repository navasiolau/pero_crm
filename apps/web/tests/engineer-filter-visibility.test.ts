import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const customRequire = createRequire(import.meta.url);
function inject(name: string, exp: Record<string, unknown>) {
  const file = customRequire.resolve(name);
  const stub = new Module(file);
  (stub as unknown as { filename: string }).filename = file;
  (stub as unknown as { loaded: boolean }).loaded = true;
  stub.exports = exp;
  (customRequire.cache as unknown as Record<string, Module>)[file] = stub;
}
inject("@/lib/list-params", {
  useListParams: () => ({ get: () => null, set() {}, reset() {}, query: "", pending: false, revision: 0, searchRevision: 0, canReset: false }),
  useListSearch: () => ({ q: "", setQ() {} }),
  ListParamsProvider: ({ children }: { children: React.ReactNode }) => children,
});
inject("next/navigation", { useRouter: () => ({ push() {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/" });
(globalThis as unknown as { React: typeof React }).React = React;
const { ProductsFilterBar } = customRequire("../src/app/(app)/products/products-filter-bar") as typeof import("../src/app/(app)/products/products-filter-bar");
const { ProjectsFilterBar } = customRequire("../src/app/(app)/projects/filter-bar") as typeof import("../src/app/(app)/projects/filter-bar");

const engineers = [{ value: "e1", label: "Инженер" }];
test("инженер не видит фильтр инженеров, остальные видят", () => {
  const hidden = renderToStaticMarkup(React.createElement(ProductsFilterBar, { projectOptions: [], clientOptions: [], engineerOptions: engineers, hideEngineer: true }));
  assert.doesNotMatch(hidden, /Все инженеры/);
  const shown = renderToStaticMarkup(React.createElement(ProductsFilterBar, { projectOptions: [], clientOptions: [], engineerOptions: engineers }));
  assert.match(shown, /Все инженеры/);
  const projectsHidden = renderToStaticMarkup(React.createElement(ProjectsFilterBar, { clients: [], managers: [], engineers: [{ id: "e1", name: "Инженер" }], hideEngineer: true }));
  assert.doesNotMatch(projectsHidden, /Все инженеры/);
  const projectsShown = renderToStaticMarkup(React.createElement(ProjectsFilterBar, { clients: [], managers: [], engineers: [{ id: "e1", name: "Инженер" }] }));
  assert.match(projectsShown, /Все инженеры/);
});
