import type { ProductPercentageKind } from "./product-percentage-pay";

export type ProductPercentageState = "DRAFT" | "SKIPPED_ONCE" | "PENDING_FX" | "SETTLED" | "LEGACY_PROTECTED";
export interface ProductPercentageMemberView {
  userId: string;
  name: string;
  shareUnits: number;
  amount: string | null;
}
export interface ProductPercentageSectionView {
  kind: ProductPercentageKind;
  state: ProductPercentageState;
  ratePercent: string | null;
  price: string | null;
  productCurrency: string;
  payrollCurrency: string | null;
  total: string | null;
  members: ProductPercentageMemberView[];
  revision: number;
  canManage: boolean;
  canTransfer: boolean;
  ownMember: ProductPercentageMemberView | null;
  legacyPaidSummary: { amount: string; currency: string; count: number } | null;
  skippedSnapshot: { completedAt: string; reason: string | null; price: string | null;
    ratePercent: string | null; productCurrency: string;
    members: { userId: string; name: string; shareUnits: number }[] } | null;
  requiresManagerReview: boolean;
  installationWorkCandidates: { id: string; title: string; canConvert: boolean; reason: string | null }[];
  classifiedInstallationWorkIds: string[];
  transferCandidates: { userId: string; name: string }[];
}
export interface ProductPercentageView {
  productId: string;
  noModel: boolean;
  hasB3d: boolean;
  sections: Record<ProductPercentageKind, ProductPercentageSectionView>;
}
