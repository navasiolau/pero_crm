import { constants, accessSync, readFileSync } from "node:fs";

function requireGuard(value) { if (!value) throw new Error("CRM runtime isolation refused"); }
const status = readFileSync("/proc/self/status", "utf8");
requireGuard(process.getuid() === 1000 && process.geteuid() === 1000 &&
  process.getgid() === 1000 && process.getegid() === 1000 && process.getgroups().every(group => group === 1000));
for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) {
  requireGuard(new RegExp("^" + field + ":\\s+0+$", "m").test(status));
}
requireGuard(/^NoNewPrivs:\s+1$/m.test(status));
for (const key of ["DATABASE_MIGRATION_URL", "DB_PASSWORD", "POSTGRES_PASSWORD", "DIRECT_URL", "SHADOW_DATABASE_URL"]) {
  requireGuard(!process.env[key]);
}
try {
  accessSync("/run/pero-crm/migrator.env", constants.R_OK);
  requireGuard(false);
} catch (error) {
  requireGuard(error.code === "EACCES");
}
accessSync("/app/apps/web/.next/cache", constants.W_OK);
await import("./server.js");
