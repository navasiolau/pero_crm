CREATE TABLE "TelegramFinanceBinding" (
  "id" TEXT NOT NULL,
  "launchHash" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "userId" TEXT,
  "sessionVersion" INTEGER,
  "linkId" TEXT,
  "linkGeneration" INTEGER,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "TelegramFinanceBinding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramFinanceBinding_launchHash_key" ON "TelegramFinanceBinding" ("launchHash");
CREATE INDEX "TelegramFinanceBinding_chatId_createdAt_idx" ON "TelegramFinanceBinding" ("chatId", "createdAt");
