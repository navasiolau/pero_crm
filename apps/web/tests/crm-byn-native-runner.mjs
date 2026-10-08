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
const proxySource = `export const prisma = new Proxy({}, { get(_target, name) {
 const tx = globalThis.__crmBynTx;
 if (!tx) throw new Error("NATIVE_OUTER_TRANSACTION_REQUIRED");
 if (name === "$transaction") return async operation => {
   if (typeof operation !== "function") throw new Error("NATIVE_CALLBACK_TRANSACTION_ONLY");
   return operation(tx);
 };
 const value = tx[name]; return typeof value === "function" ? value.bind(tx) : value;
} });`;
const result = await build({ entryPoints: [resolve(web, "tests/crm-byn-native.mjs")], outfile: out,
 metafile: true, bundle: true, platform: "node", format: "esm", target: "node22", external: ["@prisma/client"], minify: true,
 tsconfig: resolve(web, "tsconfig.json"),
 plugins: [{ name: "outer-transaction-and-external-effects", setup(builder) {
  // Project/payment cores use these real Zod factories. A static
  // export projection avoids retaining the unused public namespace (50+ locale
  // packs and JSON schema tools); validation implementations remain unchanged.
  builder.onResolve({ filter: /^zod$/ }, () => ({ path: "zod-domain-factories", namespace: "native-zod" }));
  builder.onLoad({ filter: /.*/, namespace: "native-zod" }, () => ({ loader: "js", resolveDir: web,
   contents: `import { object, string, number, enum as enumeration, uuid, coerce } from "zod/v4";
    export { object, string, number, enumeration as enum, uuid, coerce };
    export const z = {object,string,number,enum:enumeration,uuid,coerce};` }));
  builder.onResolve({ filter: /^(@\/lib\/prisma|next\/cache|@\/server\/notifications\/notify|@\/server\/plugins\/events)$/ }, args => ({ path: args.path, namespace: "native-stubs" }));
  builder.onLoad({ filter: /.*/, namespace: "native-stubs" }, args => ({ loader: "js", contents:
   args.path === "@/lib/prisma" ? proxySource : args.path === "next/cache" ? "export const revalidatePath = () => {};" : args.path.includes("notifications") ? "export const notifyOrg = async () => {}; export const notifyPerson = async () => {}; export const notifyUser = async () => {};" :
   `import { prisma } from "@/lib/prisma"; export async function emitDomainEvent(type,payload,actor) { await prisma.domainEvent.create({data:{type,payload,actor}}); } export const dispatchEvent = async () => {};`
  }));
 } }] });
const bytes = readFileSync(out);
console.log(JSON.stringify({ kind: "crm-byn-native-bundle", out, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), dbExecuted: false, includedInputs: Object.entries(Object.values(result.metafile.outputs)[0].inputs).filter(([,info]) => info.bytesInOutput > 0).map(([path]) => path), largestInputs: Object.entries(Object.values(result.metafile.outputs)[0].inputs).sort((a,b) => b[1].bytesInOutput-a[1].bytesInOutput).slice(0,15).map(([path,info]) => ({path,bytes:info.bytesInOutput})) }));
