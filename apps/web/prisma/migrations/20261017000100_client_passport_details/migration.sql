-- Паспортные реквизиты необязательны; существующие клиенты сохраняются.
ALTER TABLE "Client"
  ADD COLUMN "passportNumber" TEXT,
  ADD COLUMN "passportIssuedBy" TEXT;
