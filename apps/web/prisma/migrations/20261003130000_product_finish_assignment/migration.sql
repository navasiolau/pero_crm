ALTER TABLE "Product" ADD COLUMN "finishRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ProductFinishAssignment" (
 "id" UUID NOT NULL, "productId" TEXT NOT NULL, "element" TEXT NOT NULL, "elementKey" TEXT NOT NULL,
 "finishId" UUID NOT NULL, "finishKind" "FinishKind" NOT NULL, "finishName" TEXT NOT NULL, "finishCode" TEXT NOT NULL,
 "finishColor" TEXT NOT NULL, "catalogRevision" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProductFinishAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductFinishAssignment_productId_elementKey_key" ON "ProductFinishAssignment"("productId", "elementKey");
CREATE INDEX "ProductFinishAssignment_finishId_idx" ON "ProductFinishAssignment"("finishId");
ALTER TABLE "ProductFinishAssignment" ADD CONSTRAINT "ProductFinishAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductFinishAssignment" ADD CONSTRAINT "ProductFinishAssignment_finishId_fkey" FOREIGN KEY ("finishId") REFERENCES "Finish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
