import { pieceworkReversal } from "@/server/tasks/piecework-reversal";
import { productTitleReversal } from "@/server/products/title-reversal";

import { workTaskLifecycleReversal } from "@/server/tasks/lifecycle-reversal";

import { taskEditReversal } from "@/server/tasks/edit-reversal";
import { workEditReversal } from "@/server/works/edit-reversal";

export const journalReversals = [productTitleReversal, workTaskLifecycleReversal, taskEditReversal, workEditReversal, pieceworkReversal];
