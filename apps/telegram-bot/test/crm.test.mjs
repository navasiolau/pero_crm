import assert from "node:assert/strict";
import test from "node:test";

process.env.BOT_RECOVERY_TEST = "1";
process.env.TELEGRAM_API_ORIGIN = "http://127.0.0.1:9080";
process.env.TELEGRAM_BOT_TOKEN = "fixture-token";
process.env.CRM_BASE_URL = "http://192.168.10.20";
process.env.CRM_API_TOKEN = "fixture-crm-token";

let payload = { service: "PERO CRM", api: "v1", plugins: [] };
let observed;
globalThis.fetch = async (input, options = {}) => {
  observed = { url: String(input), authorization: options.headers?.authorization };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const { crm, CrmError } = await import("../dist/crm.js");

test("CRM health uses the existing authenticated service and DB endpoint", async () => {
  await crm.health();
  assert.deepEqual(observed, {
    url: "http://192.168.10.20/api/v1",
    authorization: "Bearer fixture-crm-token",
  });
});

test("CRM health rejects a response that does not identify PERO API v1", async () => {
  payload = { service: "unexpected", api: "v1" };
  await assert.rejects(crm.health(), CrmError);
});
