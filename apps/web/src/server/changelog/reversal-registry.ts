import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";

export const journalReversals = [productTitleReversal, paymentVisibilityReversal, ordinaryExpenseProjectReversal];
