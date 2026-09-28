import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function existingLocalListDsn() {
  const expectedId = process.env.CRM_E2E_LOCAL_CONTAINER_ID;
  if (!expectedId || !/^[a-f0-9]{64}$/.test(expectedId)) throw new Error("Explicit approved local container ID is required");
  // Секрет остаётся в памяти; docker inspect никогда не направляется в лог.
  const [container] = JSON.parse(execFileSync("docker", ["inspect", expectedId], { encoding: "utf8", windowsHide: true }));
  assert.equal(container.Id, expectedId, "container ID mismatch");
  assert.equal(container.Name, "/pero_crm_pg", "local database name mismatch");
  assert.equal(container.State.Running, true, "local database must already be running");
  assert.ok(container.Mounts.some((mount: { Type: string; Name: string }) => mount.Type === "volume" && mount.Name === "pero_crm_v2_pgdata"), "local volume mismatch");
  const bindings = container.HostConfig.PortBindings["5432/tcp"];
  assert.ok(bindings.length === 1 && bindings[0].HostIp === "127.0.0.1" && bindings[0].HostPort === "5433", "local port binding mismatch");
  const env = Object.fromEntries(container.Config.Env.map((entry: string) => { const equal = entry.indexOf("="); return [entry.slice(0, equal), entry.slice(equal + 1)]; }));
  assert.equal(env.POSTGRES_DB, "pero_crm", "database mismatch");
  assert.equal(env.POSTGRES_USER, "pero", "database role mismatch");
  assert.ok(env.POSTGRES_PASSWORD, "local database password unavailable");
  return `postgresql://pero:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:5433/pero_crm`;
}
