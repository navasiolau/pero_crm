/**
 * Переименование папок файлового хранилища под чистые идентификаторы:
 * uploads/<старый projectId> → uploads/<номер проекта>.
 *
 * Запускается ДО миграции 20260901150000_clean_identifiers (номера проектов
 * уже финальны после миграции нормализации, а id после неё станет номером —
 * пути должны совпасть). Идемпотентно: папки с совпадающим именем пропускаются.
 *
 * Запуск: pnpm --filter @pero/web exec tsx scripts/rename-uploads-folders.ts
 */
import { existsSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const root = path.join(process.cwd(), "uploads");
  if (!existsSync(root)) {
    console.log("Хранилище uploads не найдено — нечего переименовывать");
    return;
  }

  const projects = await prisma.project.findMany({
    select: { id: true, number: true },
  });
  const byId = new Map(projects.map((project) => [project.id, project.number]));

  let renamed = 0;
  let skipped = 0;
  const unknown: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = byId.get(entry.name);
    if (target === undefined) {
      unknown.push(entry.name);
      continue;
    }
    if (target === entry.name) {
      skipped += 1;
      continue;
    }
    const from = path.join(root, entry.name);
    const to = path.join(root, target);
    if (existsSync(to)) {
      // Коллизия имён: содержимое переносить некуда — сообщим и пропустим
      console.error(`!! Целевая папка уже существует: ${to} (из ${from})`);
      unknown.push(entry.name);
      continue;
    }
    renameSync(from, to);
    renamed += 1;
    console.log(`${entry.name} → ${target}`);
  }

  console.log(
    `Готово: переименовано ${renamed}, уже верно ${skipped},` +
      ` вне соответствия ${unknown.length}`,
  );
  if (unknown.length > 0) {
    console.log("Папки без проекта (не тронуты):", unknown.join(", "));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
