'use strict';
/** Предел байтов соответствует полю Int в БД; фиксированных сроков и числа позиций нет. */
const bytes = 2_147_483_647;
module.exports = Object.freeze({ requestBytes: bytes, docxRequestBytes: bytes,
  stateBytes: bytes, items: Number.MAX_SAFE_INTEGER, assetBytes: bytes,
  totalAssetBytes: bytes, pdfBytes: bytes,
  docxSources: Number.MAX_SAFE_INTEGER, docxPngBytes: bytes, docxTotalPngBytes: bytes,
  docxBytes: bytes, rasterPageBytes: bytes,
  deadlineMs: 0, queue: 4 });
