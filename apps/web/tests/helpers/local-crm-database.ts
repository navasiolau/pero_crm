import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** Explicitly guarded existing local CRM only. The password never leaves memory. */
export function existingLocalCrmDatabaseUrl(): string {
  const expectedId = process.env.CRM_LOCAL_CONTAINER_ID;
  assert.match(expectedId ?? "", /^[a-f0-9]{64}$/, "Expected local container ID is required");
  const [container] = JSON.parse(execFileSync("docker", ["inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true }));
  assert.equal(container.Id, expectedId, "Local CRM container identity mismatch");
  assert.equal(container.State.Running, true, "Local CRM database is not running");
  const bindings = container.NetworkSettings.Ports["5432/tcp"] as { HostIp: string; HostPort: string }[];
  assert.ok(bindings.some((binding) => binding.HostIp === "127.0.0.1" && binding.HostPort === "5433"), "Local CRM port guard failed");
  const env = new Map<string, string>((container.Config.Env as string[]).map((entry) => {
    const index = entry.indexOf("=");
    return [entry.slice(0, index), entry.slice(index + 1)];
  }));
  assert.equal(env.get("POSTGRES_DB"), "pero_crm", "Local CRM database name mismatch");
  assert.equal(env.get("POSTGRES_USER"), "pero", "Local CRM database user mismatch");
  assert.ok(env.get("POSTGRES_PASSWORD"), "Local CRM database password is unavailable");
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm");
  url.username = env.get("POSTGRES_USER")!;
  url.password = env.get("POSTGRES_PASSWORD")!;
  return url.toString();
}
