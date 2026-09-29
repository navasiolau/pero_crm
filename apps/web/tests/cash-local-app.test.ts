import assert from "node:assert/strict";
import { test } from "node:test";
import { cashAppEnvironment } from "./cash-local-app.mjs";

test("foreground cash app environment keeps only OS essentials, reviewed loopback target and private secret", () => {
  const env = cashAppEnvironment({ PATH: "C:\\bin", TEMP: "C:\\Temp", S3_ACCESS_KEY: "private",
    SMTP_PASSWORD: "private", DATABASE_URL: "postgresql://production", NODE_OPTIONS: "--unsafe",
    DOCKER_HOST: "tcp://foreign" }, "postgresql://pero:private@127.0.0.1:5433/pero_crm", "private-secret") as Record<string, string>;
  assert.equal(env.PATH, "C:\\bin");
  assert.equal(env.TEMP, "C:\\Temp");
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.equal(env.PORT, "3106");
  assert.equal(env.AUTH_URL, "http://127.0.0.1:3106");
  assert.equal(env.AUTH_SECRET, "private-secret");
  assert.equal(env.DATABASE_URL, "postgresql://pero:private@127.0.0.1:5433/pero_crm");
  for (const forbidden of ["S3_ACCESS_KEY", "SMTP_PASSWORD", "NODE_OPTIONS", "DOCKER_HOST"])
    assert.equal(Object.hasOwn(env, forbidden), false);
});
