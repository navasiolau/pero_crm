/** Операторский модуль: импорт не создаёт PrismaClient и не подключается к БД. */
export { planStageRetirement, applyStageRetirement } from "../src/server/projects/stage-retirement";
export type { StageRetirementPorts, StageRetirementPlan, StageRetirementRequest, StageRetirementTarget } from "../src/server/projects/stage-retirement";

// Прямой CLI намеренно inert: live guards предоставляет существующий Root transport, не флаги.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/retire-stages.ts")) {
  process.stdout.write("INERT: используйте planStageRetirement/applyStageRetirement через reviewed Root transport с live target/image/process proof. БД не подключалась.\n");
  if (process.argv.length > 2) process.exitCode = 2;
}
