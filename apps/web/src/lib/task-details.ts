import type { TaskStatus } from "@prisma/client";
import type { FileListItem } from "@/lib/viewable-file";

export interface TaskDetails {
  id: string;
  title: string;
  type: string | null;
  status: TaskStatus;
  dueAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  requiresPhoto: boolean;
  estimateMinutes: number | null;
  spentMinutes: number;
  rewardAmount?: string | null;
  rewardCurrency?: string | null;
  rewardSource?: "WORK_SNAPSHOT" | "FROZEN_TASK_SNAPSHOT" | "UNAVAILABLE";
  workId: string | null;
  workTitle: string | null;
  workTotal: string | null; // итого по всей работе
  workPriceSnapshot: string | null; // цена-снимок за единицу
  quantity: string | null; // исходный объём; у разделённых задач общий для группы
  allocationGroupId?: string | null;
  shareUnits?: number;
  shareAmount?: string | null;
  shareCurrency?: string | null;
  paymentKind?: "LEGACY" | "ENGINEERING" | "INSTALLATION";
  physicalShareUnits?: number;
  stageShareUnits?: number | null;
  previewAmount?: string | null;
  previewCurrency?: string | null;
  previewReason?: string | null;
  settledSource?: boolean;
  personalQuantity?: string | null;
  splitRevision?: number;
  canSplit?: boolean;
  dependencies: { id: string; title: string; status: TaskStatus }[];
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  productId: string | null; // изделие проекта (необязательно)
  productNumber: string | null;
  productTitle: string | null;
  files: FileListItem[];
  createdAt: string;
  doneAt: string | null;
  doneByName: string | null;
  createdByName: string | null;
}
