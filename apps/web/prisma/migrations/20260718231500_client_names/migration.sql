-- Поля Фамилия/Отчество вместо поля «Компания» (по ревью: юрлицо пишут в имени)
ALTER TABLE "Client" DROP COLUMN "company";
ALTER TABLE "Client" ADD COLUMN "lastName" TEXT;
ALTER TABLE "Client" ADD COLUMN "middleName" TEXT;
