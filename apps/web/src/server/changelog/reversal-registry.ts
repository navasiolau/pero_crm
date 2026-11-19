import { warehouseCatalogReversal } from "@/server/warehouse/catalog-reversal";
import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";

export const journalReversals = [warehouseCatalogReversal, productTitleReversal, paymentVisibilityReversal, ordinaryExpenseProjectReversal, expenseReceiptReversal];
