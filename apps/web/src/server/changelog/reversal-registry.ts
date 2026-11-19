import { notificationReadReversal } from "@/server/notifications/read-reversal";
import { pluginMutationReversal } from "@/server/plugins/settings-reversal";
import { financeDocumentUploadReversal } from "@/server/finance-documents/upload-reversal";
import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { retainedFileReversal } from "@/server/files/retained-file-reversal";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";
import { proposalMediaUploadReversal } from "@/server/kp/media-upload-reversal";
import { logisticsReallocationReversal } from "@/server/logistics/reallocation-reversal";
import { expenseReceiptIssueReversal } from "@/server/warehouse/expense-issue-reversal";

export const journalReversals = [
  productTitleReversal,
  paymentVisibilityReversal,
  retainedFileReversal,
  expenseReceiptReversal,
  ordinaryExpenseProjectReversal,
  proposalMediaUploadReversal,
  logisticsReallocationReversal,
  expenseReceiptIssueReversal,
  financeDocumentUploadReversal,
  pluginMutationReversal,
  notificationReadReversal,
];
