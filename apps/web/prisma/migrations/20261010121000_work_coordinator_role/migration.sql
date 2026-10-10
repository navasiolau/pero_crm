-- Дополнительная роль не назначается существующим сотрудникам и не меняет оплату.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'WORK_COORDINATOR';
