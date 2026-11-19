import { warehouseMovementReversal } from "@/server/warehouse/movement-reversal";
import { expenseReceiptIssueReversal } from "@/server/warehouse/expense-issue-reversal";
import { warehouseCatalogReversal } from "@/server/warehouse/catalog-reversal";
import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { retainedFileReversal } from "@/server/files/retained-file-reversal";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";
import { proposalMediaUploadReversal } from "@/server/kp/media-upload-reversal";
import { logisticsReallocationReversal } from "@/server/logistics/reallocation-reversal";

export const journalReversals = [
  warehouseMovementReversal,
  expenseReceiptIssueReversal,
  warehouseCatalogReversal,
  productTitleReversal,
  paymentVisibilityReversal,
  retainedFileReversal,
  expenseReceiptReversal,
  ordinaryExpenseProjectReversal,
  proposalMediaUploadReversal,
  logisticsReallocationReversal,
];
