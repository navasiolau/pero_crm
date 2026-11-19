import { apiTokenCreationReversal } from "@/server/plugins/token-creation-reversal";
import { userCreationReversal } from "@/server/users/creation-reversal";
import { savedListChoiceReversal } from "@/server/list-preference-reversal";
import { notificationPreferenceReversal } from "@/server/notifications/preference-reversal";
import { viewPreferenceReversal } from "@/server/view-preference-reversal";
import { telegramLinkReversal } from "@/server/telegram/link-reversal";
import { userSettingsReversal } from "@/server/users/settings-reversal";
import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";

export const journalReversals = [
  productTitleReversal, paymentVisibilityReversal, ordinaryExpenseProjectReversal, expenseReceiptReversal,
  userSettingsReversal, notificationPreferenceReversal, viewPreferenceReversal, telegramLinkReversal,
  savedListChoiceReversal, userCreationReversal, apiTokenCreationReversal,
];
