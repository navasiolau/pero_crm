import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";
import { expenseReceiptIssueReversal } from "@/server/warehouse/expense-issue-reversal";

export const journalReversals = [productTitleReversal, paymentVisibilityReversal, ordinaryExpenseProjectReversal, expenseReceiptReversal, expenseReceiptIssueReversal];
