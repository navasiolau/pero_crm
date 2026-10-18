(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PeroKpList = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  async function collectProposalPages(fetchPage) {
    var cursor = null, seen = new Set(), documents = new Map();
    for (var page = 0; page < 1000; page++) {
      var response = await fetchPage(cursor);
      if (!response || !Array.isArray(response.documents)) throw new Error('Не удалось получить список КП');
      response.documents.forEach(function (document) { documents.set(document.id, document); });
      var next = response.nextCursor;
      if (next == null) return Array.from(documents.values());
      if (typeof next !== 'string' || !next || seen.has(next)) throw new Error('Не удалось продолжить список КП');
      seen.add(next); cursor = next;
    }
    throw new Error('Список КП слишком велик. Уточните поиск');
  }
  return { collectProposalPages: collectProposalPages };
}));
