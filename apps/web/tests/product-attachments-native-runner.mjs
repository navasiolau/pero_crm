// Build only by default. DB execution is an explicit orchestrator action.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv[2]) throw new Error("EXPLICIT_BUNDLE_OUTPUT_PATH_REQUIRED");
const out = resolve(process.argv[2]);
// Derive the static namespace from exactly the schema-bearing native dependencies.
const schemaSources = ["server/product-percentage-pay/core.ts", "server/files/upload-context.ts"];
const factories = [...new Set(schemaSources.flatMap(file => [...readFileSync(resolve(web,"src",file),"utf8").matchAll(/\bz\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1])))].filter(name => !["infer","input","output"].includes(name) && !name.startsWith("Zod")).sort();
const imports = factories.map(name => name === "enum" ? "enum as enumeration" : name).join(",");
const properties = factories.map(name => name === "enum" ? "enum:enumeration" : name).join(",");
const zodProjection = `import {${imports}} from "zod/v4"; export const z={${properties}};`;

const proxySource = `export const prisma = new Proxy({}, { get(_target, name) {
 const tx = globalThis.__crmAttachmentsTx;
 if (!tx) throw new Error("NATIVE_OUTER_TRANSACTION_REQUIRED");
 if (name === "$transaction") return async operation => {
   if (typeof operation !== "function") throw new Error("NATIVE_CALLBACK_TRANSACTION_ONLY");
   const boundary = globalThis.__crmAttachmentsTransaction;
   if (typeof boundary !== "function") throw new Error("NATIVE_SAVEPOINT_BOUNDARY_REQUIRED");
   return boundary(operation);
 };
 const value = tx[name]; return typeof value === "function" ? value.bind(tx) : value;
} });`;
const result = await build({ entryPoints: [resolve(web, "tests/product-attachments-native.mjs")], outfile: out,
 metafile: true, bundle: true, platform: "node", format: "esm", target: "node22", external: ["@prisma/client"], minify: true,
 tsconfig: resolve(web, "tsconfig.json"),
 plugins: [{ name: "outer-transaction-and-external-effects", setup(builder) {
  // Product/contact cores use the following real Zod factories. A static
  // export projection avoids retaining the unused public namespace (50+ locale
  // packs and JSON schema tools); validation implementations remain unchanged.
  builder.onResolve({ filter: /^zod$/ }, () => ({ path: "zod-domain-factories", namespace: "native-zod" }));
  builder.onLoad({ filter: /.*/, namespace: "native-zod" }, () => ({ loader: "js", resolveDir: web,
   contents: zodProjection }));
  builder.onResolve({ filter: /^(@\/lib\/prisma|next\/cache|@\/server\/notifications\/notify|@\/server\/plugins\/events)$/ }, args => ({ path: args.path, namespace: "native-stubs" }));
  builder.onLoad({ filter: /.*/, namespace: "native-stubs" }, args => ({ loader: "js", contents:
   args.path === "@/lib/prisma" ? proxySource : args.path === "next/cache" ? "export const revalidatePath = () => {};" : args.path.includes("notifications") ? "export const notifyOrg = async () => {}; export const notifyPerson = async () => {}; export const notifyUser = async () => {};" :
   `import { prisma } from "@/lib/prisma"; export async function emitDomainEvent(type,payload,actor) { await prisma.domainEvent.create({data:{type,payload,actor}}); } export const dispatchEvent = async () => {};`
  }));
 } }] });
const bytes = readFileSync(out);
if(bytes.length>256*1024) throw new Error("REVIEWED_NATIVE_BUNDLE_LIMIT_EXCEEDED");
console.log(JSON.stringify({ kind: "product-attachments-native-bundle", out, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), dbExecuted: false, zodFactories: factories, largestInputs: Object.entries(Object.values(result.metafile.outputs)[0].inputs).sort((a,b) => b[1].bytesInOutput-a[1].bytesInOutput).slice(0,15).map(([path,info]) => ({path,bytes:info.bytesInOutput})) }));
