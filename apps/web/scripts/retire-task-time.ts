/** Операторский entry point: импорт и прямой CLI не создают PrismaClient и не подключаются к БД. */
export { planTaskTimeCutoff, applyTaskTimeCutoff } from "../src/server/time/cutoff";
export type { TaskTimeCutoffPorts, TaskTimeCutoffTarget, TaskTimeCutoffRequest, TaskTimeCutoffPlan } from "../src/server/time/cutoff";

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/retire-task-time.ts")) {
  process.stdout.write("INERT: используйте planTaskTimeCutoff/applyTaskTimeCutoff через reviewed Root transport с живым target/SHA/process proof. БД не подключалась.\n");
  if (process.argv.length > 2) process.exitCode = 2;
}
