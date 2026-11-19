import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";

export const journalReversals = [productTitleReversal, paymentVisibilityReversal, expenseReceiptReversal];
