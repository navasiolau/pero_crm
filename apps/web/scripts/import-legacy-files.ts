// Копирование файлов legacy CRM в хранилище v2 (§13).
// Пары «запись File → файл на диске» созданы миграцией 20260830120000_legacy_import;
// этот скрипт копирует содержимое из legacy_export/out/storage в uploads/<projectId>/.
//
// Запуск: pnpm --filter @pero/web exec tsx scripts/import-legacy-files.ts
// Legacy база используется только на чтение (SELECT path из files).

import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";
import { PrismaClient } from "@prisma/client";

const LEGACY_URL =
  process.env.LEGACY_DATABASE_URL ??
  "postgresql://pero:pero_legacy_dev@127.0.0.1:5432/pero_legacy_clean";
// path в legacy-таблице относителен к legacy_export/out (напр. «storage\58_...»)
const LEGACY_OUT = "D:\\legacy_export\\out";
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const CONCURRENCY = 16;

async function main() {
  const prisma = new PrismaClient();
  const legacy = new Client({ connectionString: LEGACY_URL });

  await legacy.connect();

  const files = await prisma.file.findMany({
    where: { legacyTable: "files" },
    select: { id: true, storedName: true, projectId: true },
  });
  const paths = new Map<string, string>();
  const res = await legacy.query<{ id: string; path: string }>(
    "SELECT id::text AS id, path FROM files WHERE table_id IN (181, 241, 47)",
  );
  for (const row of res.rows) paths.set(row.id, row.path);

  await legacy.end();

  console.log(`Записей File: ${files.length}, путей в legacy: ${paths.size}`);

  let copied = 0;
  let skippedExisting = 0;
  const missing: string[] = [];
  let index = 0;

  async function worker() {
    while (index < files.length) {
      const f = files[index++];
      // legacyId хранится в суффиксе id записи: legacy_file_<files.id>
      const src = paths.get(f.id.replace(/^legacy_file_/, ""));
      if (!src) {
        missing.push(`${f.id}: нет записи в legacy files`);
        continue;
      }
      const srcPath = path.join(LEGACY_OUT, src);
      if (!existsSync(srcPath)) {
        missing.push(`${f.id}: ${srcPath} отсутствует на диске`);
        continue;
      }
      const destDir = path.join(UPLOADS_ROOT, f.projectId);
      const destPath = path.join(destDir, f.storedName);
      if (existsSync(destPath)) {
        skippedExisting++;
        continue;
      }
      await mkdir(destDir, { recursive: true });
      await copyFile(srcPath, destPath);
      copied++;
      if (copied % 200 === 0) console.log(`Скопировано: ${copied}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`Готово. Скопировано: ${copied}, уже было: ${skippedExisting}, пропущено: ${missing.length}`);
  if (missing.length > 0) {
    console.log("Пропуски:");
    for (const m of missing.slice(0, 50)) console.log(`  ${m}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
