-- Комбинированные роли (§4): скаляр role → массив roles.
-- Существующие пользователи сохраняют свою текущую роль как единственную;
-- комбинации назначаются дальше через админку (ADMIN/DIRECTOR не комбинируются).
ALTER TABLE "User" ADD COLUMN "roles" "Role"[];
UPDATE "User" SET "roles" = ARRAY["role"]::"Role"[];
ALTER TABLE "User" ALTER COLUMN "roles" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "role";
