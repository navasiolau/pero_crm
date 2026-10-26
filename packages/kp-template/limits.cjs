'use strict';
/** Единый протокол ограничений: API проверяет до base64, renderer повторяет проверку. */
module.exports = Object.freeze({ requestBytes: 96 * 1024 * 1024, docxRequestBytes: 192 * 1024 * 1024,
  stateBytes: 4 * 1024 * 1024, items: 200, assetBytes: 12 * 1024 * 1024,
  totalAssetBytes: 64 * 1024 * 1024, pdfBytes: 32 * 1024 * 1024,
  docxSources: 1000, docxPngBytes: 16 * 1024 * 1024, docxTotalPngBytes: 128 * 1024 * 1024,
  docxBytes: 128 * 1024 * 1024, rasterPageBytes: 16 * 1024 * 1024,
  deadlineMs: 60_000, queue: 4 });
