(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PeroKpLocalState = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function canonical(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
  }
  function stamp(value) { var number = Date.parse(value); return Number.isFinite(number) ? number : 0; }
  function localWins(draft, remote) {
    if (!draft?.local?.state || !remote.canEdit) return false;
    var local = draft.local, saved = { state: remote.state, fx: remote.fx, client: remote.client };
    if (canonical(local) === canonical(saved)) return false;
    if (!draft.editedAt) return draft.baseRevision === remote.revision;
    // Продолжение собственного ACK причинно новее его снимка, даже при позднем ответе.
    return draft.followsRevision === remote.revision || draft.editedAt > stamp(remote.updatedAt);
  }
  function createClock(monotonic) {
    var read = monotonic || function () { return performance.now(); }, anchor = null;
    return {
      sample: function (serverTime, started) {
        var received = read(), time = Number(serverTime);
        if (serverTime != null && Number.isFinite(time) && time > 0) anchor = { time: time + Math.max(0, received - started) / 2, at: received };
      },
      now: function () { return anchor ? anchor.time + Math.max(0, read() - anchor.at) : null; },
      read: read
    };
  }
  function create(options) {
    var prefix = 'pero-crm-kp:' + encodeURIComponent(options.actorId) + ':', cache = new Map(), loaded = new Map(), queue = Promise.resolve(), opening;
    var notice = options.onError || function () {};
    function failed() { notice('Локальное сохранение недоступно. Несохранённые правки остаются в открытом редакторе.'); }
    function open() {
      if (!opening) opening = new Promise(function (resolve, reject) {
        if (!options.indexedDB) { reject(new Error('INDEXEDDB_UNAVAILABLE')); return; }
        var request;
        try { request = options.indexedDB.open('pero-kp-local', 1); } catch (error) { reject(error); return; }
        request.onupgradeneeded = function () { request.result.createObjectStore('documents', { keyPath: 'id' }); };
        request.onsuccess = function () { var db = request.result; db.onversionchange = function () { db.close(); opening = null; }; resolve(db); };
        request.onerror = function () { reject(request.error); };
        request.onblocked = function () { reject(new Error('INDEXEDDB_BLOCKED')); };
      });
      return opening;
    }
    function location(key) {
      if (!key.startsWith(prefix)) return null;
      var rest = key.slice(prefix.length), split = rest.indexOf(':');
      return split < 0 ? null : { id: prefix + rest.slice(0, split), name: rest.slice(split + 1) };
    }
    async function transaction(id, change) {
      var db = await open();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents'), request = store.get(id), result;
        request.onsuccess = function () {
          try {
            var row = request.result || { id: id, values: {}, migrated: false };
            result = change(row); store.put(row);
          } catch (error) { reject(error); tx.abort(); }
        };
        tx.oncomplete = function () { resolve(result); };
        tx.onabort = tx.onerror = function () { reject(tx.error || new Error('INDEXEDDB_ABORTED')); };
      });
    }
    function enqueue(action) { var next = queue.then(action); queue = next.catch(function () { failed(); }); return next; }
    function legacy(documentId, remote) {
      var values = {}, originals = [], candidates = [], start = prefix + encodeURIComponent(documentId) + ':', storage = options.legacyStorage;
      if (!storage) return { values: values, originals: originals };
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i); if (!key?.startsWith(start)) continue;
        var raw = storage.getItem(key), value; try { value = JSON.parse(raw); } catch (_) { continue; }
        var name = key.slice(start.length), match = /^draft:(\d+)$/.exec(name);
        if (match && Array.isArray(value?.local?.state?.items || value?.items)) {
          var local = value.schema === 1 ? value.local : { state: value, fx: remote.fx, client: remote.client };
          if (value.documentId && value.documentId !== documentId || value.__docId && value.__docId !== documentId) continue;
          if (value.base && canonical(local) === canonical(value.base)) { originals.push([key, raw]); continue; }
          var state = Object.assign({}, local.state); delete state.__docId;
          candidates.push({ schema: 2, editId: 'legacy:' + match[1], baseRevision: Number(match[1]), editedAt: 0,
            local: { state: state, fx: local.fx ?? remote.fx, client: local.client ?? remote.client } });
          originals.push([key, raw]);
        } else if (/^operation:(save|pdf|create|contract|contract-settings|restore:[A-Za-z0-9_.:-]+)$/.test(name) && value?.body?.operationId) {
          if (value.body.proposalId && value.body.proposalId !== documentId || value.body.documentId && value.body.documentId !== documentId) continue;
          values[name] = raw; originals.push([key, raw]);
        } else if (/^(draft:(backup|legacy-backup):|save-recovery:)/.test(name) && value && typeof value === 'object') {
          if (value.documentId && value.documentId !== documentId || value.proposalId && value.proposalId !== documentId) continue;
          var previous = /^draft:legacy-backup:(\d+)$/.exec(name), source, revision, sidecar;
          if (previous && Array.isArray(value.items)) {
            source = Object.assign({}, value); delete source.__docId; revision = Number(previous[1]);
          } else if (name.startsWith('draft:backup:') && value.schema === 1 && value.documentId === documentId && Array.isArray(value.state?.items)) {
            source = value.detail?.draft?.state || value.state;
            revision = value.detail?.draft?.revision ?? value.context?.revision;
            sidecar = value.detail?.draft?.local;
          } else if (name.startsWith('save-recovery:') && value.schema === 1 && value.proposalId === documentId && value.pending?.body?.operationId && Array.isArray(value.local?.state?.items)) {
            source = value.local.state; revision = value.pending.body.expectedRevision;
            sidecar = { fx: value.local.fx, client: value.local.clientId ? { id: value.local.clientId } : null };
          }
          if (!Array.isArray(source?.items) || !Number.isSafeInteger(revision)) continue;
          candidates.push({ schema: 2, editId: 'legacy:' + name, baseRevision: revision, editedAt: 0,
            local: { state: source, fx: sidecar?.fx ?? remote.fx, client: sidecar?.client ?? remote.client } });
          originals.push([key, raw]);
        }
      }
      candidates.sort(function (a, b) { return b.baseRevision - a.baseRevision; });
      var candidate = candidates.find(function (draft) { return localWins(draft, remote); });
      if (candidate) values.draft = JSON.stringify(candidate);
      return { values: values, originals: originals };
    }
    async function prepare(documentId, remote) {
      var id = prefix + encodeURIComponent(documentId);
      if (loaded.has(id)) return loaded.get(id);
      var pending = (async function () {
        try {
          var imported = { values: {}, originals: [] };
          try { imported = legacy(documentId, remote || {}); } catch (_) { failed(); }
          var result = await transaction(id, function (row) {
            var migrated = !row.migrated;
            if (migrated) { row.values = Object.assign({}, imported.values, row.values); row.migrated = true; }
            return { row: row, migrated: migrated };
          });
          var row = result.row;
          Object.keys(row.values).forEach(function (name) { cache.set(id + ':' + name, row.values[name]); });
          if (result.migrated) imported.originals.forEach(function (entry) { if (options.legacyStorage.getItem(entry[0]) === entry[1]) options.legacyStorage.removeItem(entry[0]); });
        } catch (_) { failed(); }
      })();
      loaded.set(id, pending); return pending;
    }
    function getItem(key) { return cache.get(key) ?? null; }
    function setItem(key, value) {
      var place = location(key); if (!place) return;
      if (cache.get(key) === value) return;
      cache.set(key, value);
      void enqueue(function () { return transaction(place.id, function (row) {
        if (place.name === 'draft' && row.values.draft) {
          var existing = JSON.parse(row.values.draft), incoming = JSON.parse(value);
          if (existing.editedAt > incoming.editedAt) return;
        }
        row.values[place.name] = value;
      }); }).catch(function () {});
    }
    function removeItem(key) {
      var place = location(key), expected = cache.get(key); if (!place || expected == null) return;
      cache.delete(key);
      void enqueue(function () { return transaction(place.id, function (row) { if (row.values[place.name] === expected) delete row.values[place.name]; }); }).catch(function () {});
    }
    async function refresh(documentId) {
      await queue;
      var id = prefix + encodeURIComponent(documentId);
      try {
        var row = await transaction(id, function (row) { return row; });
        Object.keys(row.values).forEach(function (name) { cache.set(id + ':' + name, row.values[name]); });
        for (var key of cache.keys()) if (key.startsWith(id + ':') && !Object.hasOwn(row.values, key.slice(id.length + 1))) cache.delete(key);
      } catch (_) { failed(); }
    }
    async function claimOperation(key, value) {
      await queue; var place = location(key);
      try {
        var selected = await transaction(place.id, function (row) { return row.values[place.name] || (row.values[place.name] = value); });
        cache.set(key, selected); return selected;
      } catch (_) { failed(); cache.set(key, value); return value; }
    }
    return { prepare: prepare, refresh: refresh, getItem: getItem, setItem: setItem, removeItem: removeItem,
      claimOperation: claimOperation, flush: function () { return queue; } };
  }
  return { create: create, canonical: canonical, localWins: localWins, createClock: createClock };
}));
