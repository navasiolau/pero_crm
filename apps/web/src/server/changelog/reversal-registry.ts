import { productTitleReversal } from "@/server/products/title-reversal";
import { retainedFileReversal } from "@/server/files/retained-file-reversal";
import { proposalMediaUploadReversal } from "@/server/kp/media-upload-reversal";

export const journalReversals = [productTitleReversal, retainedFileReversal, proposalMediaUploadReversal];
