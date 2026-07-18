-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DIRECTOR', 'MANAGER', 'ENGINEER', 'WORKER', 'MOUNTER');

-- CreateEnum
CREATE TYPE "PayScheme" AS ENUM ('PIECE', 'PERCENT_PROJECT', 'PERCENT_TURNOVER', 'NONE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "payScheme" "PayScheme" NOT NULL DEFAULT 'NONE',
    "payPercent" DECIMAL(5,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" TEXT,
    "legacyTable" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
