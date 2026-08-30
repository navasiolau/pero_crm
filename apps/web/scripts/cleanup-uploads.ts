// Удаляет папки-сироты из uploads/: проект был отфильтрован при повторной
// миграции, но папка осталась. Запуск: tsx scripts/cleanup-uploads.ts
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

async function main() {
  const prisma = new PrismaClient();
  const projects = new Set(
    (await prisma.project.findMany({ select: { id: true } })).map((p) => p.id),
  );
  const dirs = (await readdir(UPLOADS_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let removed = 0;
  for (const dir of dirs) {
    if (!projects.has(dir)) {
      await rm(path.join(UPLOADS_ROOT, dir), { recursive: true, force: true });
      removed++;
    }
  }
  console.log(`Папок проектов: ${projects.size}, удалено сирот: ${removed}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
