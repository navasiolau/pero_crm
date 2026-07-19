import path from "node:path";

// Корень файлового хранилища (§13): диск, структура по проектам.
// В docker-деплое — volume /app/uploads.
export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
