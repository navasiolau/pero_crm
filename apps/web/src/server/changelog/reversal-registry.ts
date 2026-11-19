import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";

import { payrollAccrualReversal } from "@/server/payroll/accrual-reversal";
import { payoutVisibilityReversal } from "@/server/payroll/payout-reversal";

export const journalReversals = [productTitleReversal, paymentVisibilityReversal, payoutVisibilityReversal, payrollAccrualReversal];
