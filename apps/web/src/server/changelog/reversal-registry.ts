import { productSpecificationReversal } from '@/server/products/specification-reversal';
import { projectFieldReversals } from '@/server/projects/field-reversal';
import { productFieldReversals } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { retainedFileReversal } from "@/server/files/retained-file-reversal";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";
import { proposalMediaUploadReversal } from "@/server/kp/media-upload-reversal";
import { logisticsReallocationReversal } from "@/server/logistics/reallocation-reversal";
import { expenseReceiptIssueReversal } from "@/server/warehouse/expense-issue-reversal";

import { payrollAccrualReversal } from '@/server/payroll/accrual-reversal';
import { payoutVisibilityReversal } from '@/server/payroll/payout-reversal';
export const journalReversals = [
  payrollAccrualReversal, payoutVisibilityReversal,
  ...productFieldReversals,
  productSpecificationReversal,
  ...projectFieldReversals,
  paymentVisibilityReversal,
  retainedFileReversal,
  expenseReceiptReversal,
  ordinaryExpenseProjectReversal,
  proposalMediaUploadReversal,
  logisticsReallocationReversal,
  expenseReceiptIssueReversal,
];
