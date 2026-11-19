import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(web, "package.json"));
const pages = ["src/app/(app)/projects/[id]/page.tsx", "src/app/(app)/products/[id]/page.tsx"];
const common = `
export const state={roles:['ADMIN'],journalRenders:[]};
export const project={id:'project-stable',number:'203',title:'Проект',clientId:'client',client:{id:'client',name:'Клиент'},stage:'LEAD',currency:'BYN',createdAt:new Date('2026-11-16'),stageChangedAt:new Date('2026-11-16'),createdById:null,products:[],tasks:[],works:[],payments:[],files:[],stageHistory:[],managerId:null};
export const product={id:'product-stable',projectId:project.id,number:'203.1',title:'Изделие',project,status:'PREPARATION',statusChangedAt:new Date('2026-11-16'),quantity:1,files:[],tasks:[],works:[],sketchFile:null,engineerId:null,canAccessDraft:true,technicalSpecifications:null};
`;
const boundaries = {
  "next/navigation": "export const redirect=()=>{throw Error('UNEXPECTED_REDIRECT')}; export const notFound=()=>{throw Error('UNEXPECTED_NOT_FOUND')};",
  "next/link": "export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}",
  "next/dynamic": "export default function dynamic(){return ()=> <div>Вкладка модуля</div>}",
  "@/auth": "import {state} from 'journal-page-fixture'; export async function auth(){return {user:{id:'actor',name:'Пользователь',roles:state.roles}}}",
  "@/lib/prisma": "const empty=async()=>[];export const prisma={priceItem:{findMany:empty},user:{findMany:empty},expenseArticle:{findMany:empty}};",
  "@/lib/file-management": "export const canManageProductFiles=()=>false;",
  "@/server/projects/queries": "import{project}from'journal-page-fixture';export const getProjectFor=async()=>project;export const listClients=async()=>[];export const listEngineers=listClients,listManagers=listClients,listWorkers=listClients;",
  "@/server/products/queries": "import{product}from'journal-page-fixture';export const getProductFor=async()=>product;",
  "@/server/access/visibility": "export const hasFullProjectVisibility=()=>true;export const resolveVisibilityActor=async(db,user)=>user;export const canEditProductTechnicalBlock=()=>false;",
  "@/server/files/list-view": "export const ordinaryFileListView=async()=>[];",
  "@/server/files/upload-context": "export const projectFilePermissions=async()=>({canUpload:false,canManageCover:false});",
  "@/server/kp/project-pdf": "export const projectProposalPdfFile=async()=>null;",
  "@/server/finance/payment-view": "export const paymentView=x=>x;",
  "@/server/finance/project-expenses": "export const loadProjectStockExpenses=async()=>[];export const projectExpenseRows=()=>[];",
  "@/server/finance/queries": "export const getProjectEconomics=async()=>null;",
  "@/server/finance/default-cash-core": "export const listActiveCashAccountOptions=async()=>[];",
  "@/server/plugins/run-log": "export const getPluginSettings=async()=>({});",
  "@/server/plugins/slots": "export const getSlotContributions=async()=>[{pluginId:'demo',pluginName:'Модуль',loader:()=>null}];",
  "@/server/projects/project-field-core": "export const getProjectPricingProjection=async()=>null;",
  "@/server/projects/contact-projection": "export const getProjectContactProjection=async()=>null;",
  "@/server/tasks/queries": "export const mapTaskDetails=async()=>[];",
  "@/server/tasks/worker-allocation-queries": "export const listWorkerAllocationData=async()=>({});",
  "@/server/warehouse/queries": "export const getProjectMaterialsBatch=async()=>[];export const getProjectMaterials=async()=>null;export const listProductMaterialOptions=async()=>({plan:[],issue:[]});",
  "@/server/works/access": "export const canAddProductWork=()=>false;",
  "@/server/works/queries": "export const listWorkPriceOptions=async()=>[];export const listProductWorkOperations=async()=>({});",
  "@/server/products/cover-actions": "export const deleteProductSketchAction=()=>{throw Error('UNEXPECTED_WRITE')};",
  "@/server/product-percentage-pay/queries": "export const getProductPercentageView=async()=>({hasB3d:false,noModel:true,sections:{ENGINEERING:{ownMember:null},ASSEMBLY:{ownMember:null},INSTALLATION:{ownMember:null}}});",
  "../../logistics/workspace-data": "export const loadLogisticsWorkspace=async()=>null;",
  "@/components/journal/journal": "import{state}from'journal-page-fixture';export function Journal({scope}){state.journalRenders.push(scope);return <div data-fixture-journal={scope.kind} data-scope-id={scope.id}/>}",
};

async function actualPages() {
  const ts = require("typescript");
  const passive = new Map();
  const retained = new Set(["@/components/ui/tabs", "@/components/project-tabs", "@/components/journal/entity-journal", "./product-overview"]);
  // Чужие тяжёлые визуальные блоки изолированы; сами Page, Tabs, композиция изделия и EntityJournal исполняются.
  for (const relative of pages) {
    const source = ts.createSourceFile(relative, await readFile(path.join(web, relative), "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (retained.has(specifier) || Object.hasOwn(boundaries, specifier) || (!specifier.startsWith("@/components/") && !specifier.startsWith("."))) continue;
      const names = passive.get(specifier) ?? new Set();
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) names.add(element.propertyName?.text ?? element.name.text);
      passive.set(specifier, names);
    }
  }
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const result = await build({ stdin: { contents: `export {default as projectPage} from './${pages[0]}';export {default as productPage} from './${pages[1]}';export {state} from 'journal-page-fixture';`, resolveDir: web, loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), logLevel: "silent",
    plugins: [{ name: "entity-page-readers", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path === "journal-page-fixture" || Object.hasOwn(boundaries, args.path) || passive.has(args.path)) return { path: args.path, namespace: "entity-page-fixture" };
        if (args.path.startsWith("@/server/") || args.path.startsWith("next/")) throw Error(`UNDECLARED_PAGE_BOUNDARY ${args.path}`);
      });
      builder.onLoad({ filter: /.*/, namespace: "entity-page-fixture" }, args => ({ loader: "tsx", resolveDir: web,
        contents: args.path === "journal-page-fixture" ? common : boundaries[args.path] ?? [...passive.get(args.path)].map(name => `export function ${name}({children}={}){return children??null;}`).join("\n") }));
    } }],
  });
  const filename = path.join(web, "tests", "journal-entity-pages-fixture.cjs");
  const loaded = new Module(filename);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(result.outputFiles[0].text, filename);
  return loaded.exports;
}

test("actual project/product pages expose journal only to ADMIN and preserve stable entity context", async () => {
  const { projectPage, productPage, state } = await actualPages();
  const roles = [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["ENGINEER"], ["ACCOUNTANT"], ["PROCUREMENT"], ["WORKER"], ["MOUNTER"], ["WORK_COORDINATOR"], ["WORK_COORDINATOR", "WORKER"], ["MANAGER", "ENGINEER"], ["ACCOUNTANT", "PROCUREMENT"]];
  for (const combination of roles) {
    state.roles = combination; state.journalRenders = [];
    const project = renderToStaticMarkup(await projectPage({ params: Promise.resolve({ id: "203-alias" }), searchParams: Promise.resolve({ tab: "journal", returnTo: "/projects?view=table" }) }));
    const product = renderToStaticMarkup(await productPage({ params: Promise.resolve({ id: "203.1" }), searchParams: Promise.resolve({ returnTo: "/products?view=table" }) }));
    if (combination.includes("ADMIN")) {
      assert.ok(project.slice(project.lastIndexOf('data-slot="tabs-trigger"')).split("</button>")[0].endsWith(">Журнал"), "Journal must be the final project tab");
      assert.deepEqual(state.journalRenders, [{ kind: "project", id: "project-stable" }]);
      assert.match(project, /data-scope-id="project-stable"/);
      assert.match(product, /data-product-section="journal"/);
      assert.match(product, /data-entity-id="product-stable"/);
      assert.ok(product.indexOf('data-product-section="journal"') > product.indexOf('data-product-section="works"'));
      assert.doesNotMatch(product, /role="tab"/);
    } else {
      assert.doesNotMatch(project, />Журнал<|data-entity-journal|data-fixture-journal/);
      assert.doesNotMatch(product, />Журнал<|data-entity-journal|data-fixture-journal/);
      assert.deepEqual(state.journalRenders, [], combination.join("+"));
    }
  }
  state.roles = ["ADMIN"]; state.journalRenders = [];
  renderToStaticMarkup(await projectPage({ params: Promise.resolve({ id: "203" }), searchParams: Promise.resolve({}) }));
  assert.deepEqual(state.journalRenders, [], "inactive project tab must not mount Journal");
});
