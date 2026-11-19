import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { retainedFileReversal } from "@/server/files/retained-file-reversal";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";
import { proposalMediaUploadReversal } from "@/server/kp/media-upload-reversal";
import { logisticsReallocationReversal } from "@/server/logistics/reallocation-reversal";
import { expenseReceiptIssueReversal } from "@/server/warehouse/expense-issue-reversal";
import { workTaskLifecycleReversal } from "@/server/tasks/lifecycle-reversal";
import { taskEditReversal } from "@/server/tasks/edit-reversal";
import { workEditReversal } from "@/server/works/edit-reversal";
import { payoutVisibilityReversal } from "@/server/payroll/payout-reversal";
import { payrollAccrualReversal } from "@/server/payroll/accrual-reversal";
import { cardVisibilityReversal } from "@/server/projects/card-visibility-reversal";

export const journalReversals = [
  productTitleReversal,
  paymentVisibilityReversal,
  retainedFileReversal,
  expenseReceiptReversal,
  ordinaryExpenseProjectReversal,
  proposalMediaUploadReversal,
  logisticsReallocationReversal,
  expenseReceiptIssueReversal,
  workTaskLifecycleReversal,
  taskEditReversal,
  workEditReversal,
  payoutVisibilityReversal,
  payrollAccrualReversal,
  cardVisibilityReversal,
];
