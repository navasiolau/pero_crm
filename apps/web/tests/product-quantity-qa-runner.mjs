/** Root local transport. Captures private credentials, prints only a receipt. */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
const operation = process.argv[2];
if (!["prepare", "capture", "cleanup"].includes(operation)) throw new Error("EXPLICIT_QA_OPERATION_REQUIRED");
const statePath = resolve(root, ".playwright-mcp/product-quantity/qa-local.json");
const entry = resolve(import.meta.dirname, "product-quantity-qa-entry.mjs");
const result = spawnSync(process.execPath, [entry], { cwd: resolve(root, "apps/web"), windowsHide: true, encoding: "utf8",
  env: { ...process.env, CRM_PRODUCT_QUANTITY_QA: JSON.stringify({ operation, target: "local", statePath }) }, timeout: 90000 });
writeFileSync(resolve(root, `.playwright-mcp/product-quantity/${operation}.private.log`), (result.stdout ?? "") + (result.stderr ?? ""), { mode: 0o600 });
if (result.status !== 0) throw new Error("QUANTITY_QA_OPERATION_STOP");
const receipt = JSON.parse(result.stdout.trim());
writeFileSync(resolve(root, `.playwright-mcp/product-quantity/${operation}-local.json`), JSON.stringify(receipt), { mode: 0o600 });
if (operation === "prepare") console.log(JSON.stringify({ status: receipt.status, marker: receipt.marker, number: receipt.number }));
else console.log(JSON.stringify({ status: receipt.status, counts: receipt.counts, exactTables: receipt.exactTables, deleted: receipt.deleted }));
if (operation === "capture") {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.target !== "local") throw new Error("LOCAL_STATE_REQUIRED");
}
