(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kp-list.js'));
  else {
    var bootstrap = JSON.parse(document.getElementById('peroCrmBootstrap').textContent);
    root.PeroCrmKp = factory(root.PeroKpList)(bootstrap, { fetch: root.fetch.bind(root), storage: root.localStorage,
      emit: function (message) { root.parent.postMessage(Object.assign({ channel: 'pero-kp' }, message), root.location.origin); } });
    root.addEventListener('message', function (event) {
      if (event.origin !== root.location.origin || event.source !== root.parent || event.data?.channel !== 'pero-kp') return;
      root.PeroCrmKp.handleCommand(event.data).then(function () {
        root.parent.postMessage({ channel: 'pero-kp', type: 'command-result', requestId: event.data.requestId, ok: true }, root.location.origin);
      }).catch(function (error) {
        root.parent.postMessage({ channel: 'pero-kp', type: 'error', message: error.message }, root.location.origin);
        root.parent.postMessage({ channel: 'pero-kp', type: 'command-result', requestId: event.data.requestId, ok: false, message: error.message }, root.location.origin);
      });
    });
  }
}(typeof self !== 'undefined' ? self : this, function (list) {
  'use strict';
  return function createCrmTransport(bootstrap, dependencies) {
    if (!bootstrap || bootstrap.apiBase !== '/api/kp' || !bootstrap.documentId || !bootstrap.actorId) throw new Error('KP_BOOTSTRAP_INVALID');
    var fetcher = dependencies.fetch, storage = dependencies.storage, emit = dependencies.emit || function () {};
    var currentId = bootstrap.documentId, documents = {}, current = null, viewingVersion = null, uploaded = new Set();
    var editor, paused = false, saveQueue = Promise.resolve(), contractForms = {}, retainedOperations = {};
    var confirmedState = null, confirmedFx = null;
    var prefix = 'pero-crm-kp:' + encodeURIComponent(bootstrap.actorId) + ':';
    var uuid = dependencies.uuid || function () { return crypto.randomUUID(); };
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function canonical(value) {
      if (!value || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    }
    function key(id, kind) { return prefix + encodeURIComponent(id) + ':' + kind; }
    function read(keyName) { try { return JSON.parse(storage.getItem(keyName)); } catch (_) { return null; } }
    function write(keyName, value) { try { storage.setItem(keyName, JSON.stringify(value)); } catch (_) {} }
    function remove(keyName) { try { storage.removeItem(keyName); } catch (_) {} }
    function operation(id, kind, body) {
      var storageKey = key(id, 'operation:' + kind), previous = retainedOperations[storageKey] || read(storageKey);
      var fingerprint = JSON.stringify(body);
      if (previous && previous.fingerprint !== fingerprint) return { previous: previous, storageKey: storageKey };
      var entry = previous || { fingerprint: fingerprint, body: Object.assign({ operationId: uuid() }, body) };
      retainedOperations[storageKey] = entry; write(storageKey, entry);
      return { entry: entry, storageKey: storageKey };
    }
    async function request(path, options) {
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new Error('KP_API_PATH_INVALID');
      var response = await fetcher(bootstrap.apiBase + path, Object.assign({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }, options));
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) { var error = new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Не удалось выполнить запрос'); error.status = response.status; error.data = data; throw error; }
      return data;
    }
    function json(method, body) { return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
    function remember(doc) {
      if (!doc || !doc.id || !Number.isSafeInteger(doc.revision) || !doc.state || !Array.isArray(doc.state.items)) throw new Error('Некорректный ответ сохранения КП');
      documents[doc.id] = doc; currentId = doc.id; current = doc; viewingVersion = null;
      confirmedState = canonical(doc.state); confirmedFx = canonical(doc.fx);
      var staged = read(key(doc.id, 'uploads:' + doc.revision));
      uploaded = new Set(Array.isArray(staged) ? staged.filter(function (id) { return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id); }).slice(0, 400) : []);
      emit({ type: 'document', document: doc, versionId: null });
      return doc;
    }
    function acknowledgeUploads(doc) {
      var referenced = new Set();
      doc.state.items.forEach(function (item) { ['image', 'image2'].forEach(function (field) { if (typeof item[field] === 'string' && item[field].startsWith('kp-media:')) referenced.add(item[field].slice(9)); }); });
      uploaded.forEach(function (id) { if (referenced.has(id)) uploaded.delete(id); });
      if (current) remove(key(current.id, 'uploads:' + current.revision));
      write(key(doc.id, 'uploads:' + doc.revision), Array.from(uploaded));
    }
    async function replay(id, method, path, pending) {
      var data = await request(path, json(method, pending.body));
      remove(key(id, 'operation:save')); delete retainedOperations[key(id, 'operation:save')];
      return data;
    }
    async function saveNow(state) {
      if (!current || !current.canEdit || viewingVersion || paused) throw new Error('КП доступно только для просмотра');
      var snapshot = copy(state), id = currentId, path = '/documents/' + encodeURIComponent(id);
      // Предыдущая не подтверждённая операция сначала получает свой прежний ответ.
      var stored = retainedOperations[key(id, 'operation:save')] || read(key(id, 'operation:save'));
      if (stored) {
        var confirmed = await replay(id, 'PUT', path, stored); acknowledgeUploads(confirmed); remember(confirmed);
        if (JSON.stringify(snapshot) === JSON.stringify(confirmed.state)) return confirmed;
      }
      var body = { proposalId: id, expectedRevision: current.revision, state: snapshot };
      if (current.client) body.clientId = current.client.id;
      var currency = ({ '$': 'USD', '€': 'EUR', '₽': 'RUB', 'BYN': 'BYN', 'USD': 'USD', 'EUR': 'EUR', 'RUB': 'RUB' })[snapshot.currency];
      if (currency && current.fx?.currency !== currency) {
        var date = String(snapshot.order?.date || ''), parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
        var isoDate = parts ? parts[3] + '-' + parts[2] + '-' + parts[1] : date;
        var quote = await request('/rates?currency=' + currency + '&date=' + encodeURIComponent(isoDate));
        current.fx = quote.fx;
      }
      if (current.fx) body.fx = current.fx;
      var pending = operation(id, 'save', body);
      var result = await request(path, json('PUT', pending.entry.body));
      remove(pending.storageKey); delete retainedOperations[pending.storageKey];
      acknowledgeUploads(result); return remember(result);
    }
    function save(state) {
      var snapshot = copy(state);
      var next = saveQueue.catch(function () {}).then(function () { return saveNow(snapshot); });
      saveQueue = next; return next.catch(function (error) { emit({ type: 'error', message: error.message }); throw error; });
    }
    async function ensureSaved() {
      if (!current) throw new Error('КП ещё не загружено');
      if (viewingVersion || !current.canEdit) return current;
      if (paused) throw new Error('Завершите изменение клиента');
      var saved = await editor.ensureSaved();
      if (!saved || !saved.id || !Number.isSafeInteger(saved.revision)) throw new Error('КП не сохранено. Проверьте данные и повторите');
      return saved;
    }
    function publish(doc) { if (editor) editor.applyDocument(doc, !!viewingVersion); api.applyPermissions(); }
    function mediaUrl(token) {
      if (!token) return '';
      if (!/^kp-media:[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(token)) return '';
      var id = token.slice(9), scope = viewingVersion ? 'version' : uploaded.has(id) ? 'uploaded' : 'current';
      return bootstrap.apiBase + '/documents/' + encodeURIComponent(currentId) + '/media/' + encodeURIComponent(id) + '?variant=optimized&scope=' + scope +
        (viewingVersion ? '&versionId=' + encodeURIComponent(viewingVersion) : '');
    }
    function previewState(state) {
      var view = copy(state);
      view.items.forEach(function (item) { ['image', 'image2'].forEach(function (field) { if (item[field]) item[field] = mediaUrl(item[field]); }); });
      return view;
    }
    async function poll(job) {
      var deadline = Date.now() + 120000;
      while (job.state !== 'SUCCEEDED') {
        if (job.state === 'FAILED' || job.state === 'CANCELLED') { var error = new Error(job.error || 'Не удалось сформировать документ'); error.knownTerminalJob = true; throw error; }
        if (Date.now() > deadline) throw new Error('Документ ещё формируется. Повторите проверку позже');
        await new Promise(function (resolve) { setTimeout(resolve, 750); });
        job = await request('/jobs/' + encodeURIComponent(job.id));
      }
      var result = job.result;
      if (!result || typeof result.downloadUrl !== 'string' || !result.downloadUrl.startsWith('/api/kp/') || result.downloadUrl.startsWith('//')) throw new Error('Некорректная ссылка документа');
      return result;
    }
    async function publishJob(path, pending) {
      function clear() { remove(pending.storageKey); delete retainedOperations[pending.storageKey]; }
      try {
        var job = await request(path, json('POST', (pending.entry || pending.previous).body));
        var result = await poll(job); clear(); emit({ type: 'versions-changed' }); return result;
      } catch (error) { if (error.knownTerminalJob === true) clear(); throw error; }
    }
    async function generatePdf() {
      var saved = await ensureSaved();
      if (viewingVersion) throw new Error('Скачайте PDF выбранной версии из списка версий');
      var body = { proposalId: saved.id, expectedRevision: saved.revision };
      var pending = operation(saved.id, 'pdf', body);
      return publishJob('/documents/' + encodeURIComponent(saved.id) + '/pdf', pending);
    }
    async function create() {
      var date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date());
      var state = { items: [], order: { number: '', date: date, validUntil: '', project: '' }, client: { name: '', contact: '' },
        currency: 'BYN', discount: 0, discountMode: 'percent', delivery: { mode: 'total', total: 0, visible: false, items: [] } };
      var pending = operation('new', 'create', { state: state });
      var doc = await request('/documents', json('POST', (pending.entry || pending.previous).body));
      remove(pending.storageKey); delete retainedOperations[pending.storageKey]; remember(doc); emit({ type: 'navigate', documentId: doc.id }); return doc;
    }
    async function upload(original, optimized) {
      if (!current?.canEdit || viewingVersion || paused) throw new Error('КП доступно только для просмотра');
      var body = new FormData(); body.set('file', original); body.set('optimized', optimized);
      body.set('expectedRevision', String(current.revision)); body.set('operationId', uuid());
      var result = await request('/documents/' + encodeURIComponent(currentId) + '/media', { method: 'POST', body: body });
      if (!result.reference || result.reference !== 'kp-media:' + result.mediaId || !/^kp-media:[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(result.reference)) throw new Error('Некорректный ответ загрузки');
      uploaded.add(result.mediaId); write(key(currentId, 'uploads:' + current.revision), Array.from(uploaded)); return result.reference;
    }
    async function legacyRequest(url, options) {
      options = options || {}; var parsed = new URL(url, 'http://crm.invalid');
      var id = parsed.searchParams.get('id'), documentId = parsed.searchParams.get('documentId');
      if (parsed.pathname === '/api/documents') {
        if (!id && (!options.method || options.method === 'GET')) {
          var rows = await list.collectProposalPages(function (cursor) { return request('/documents' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')); });
          return { documents: rows.map(function (row) { var number = row.number || row.project?.number || ''; return Object.assign({}, row, {
            name: 'КП №' + number + ' — ' + (row.client?.label || row.printedClientName || row.name || ''),
          }); }) };
        }
        if (!options.method || options.method === 'GET') { var doc = await request('/documents/' + encodeURIComponent(id)); documents[id] = doc; return doc; }
        if (options.method === 'DELETE') {
          throw new Error('Откройте проект для управления его состоянием');
        }
        if (options.method === 'PUT') return save(JSON.parse(options.body).state);
      }
      if (parsed.pathname === '/api/contracts' && (!options.method || options.method === 'GET')) {
        var form = await request('/contracts?documentId=' + encodeURIComponent(documentId)); contractForms[documentId] = form; return form;
      }
      if (parsed.pathname === '/api/contracts/history' && (!options.method || options.method === 'GET')) return request('/contracts/history?documentId=' + encodeURIComponent(documentId));
      if (parsed.pathname === '/api/contracts' && options.method === 'PUT') {
        var input = JSON.parse(options.body), form = contractForms[input.documentId];
        if (!form) throw new Error('Откройте настройки договора заново');
        var refs = input.settings.proposalIds.map(function (id) { if (!documents[id]) throw new Error('Обновите состав КП договора'); return { proposalId: id, expectedRevision: documents[id].revision }; });
        var storageKey = key(input.documentId, 'operation:contract-settings');
        var previous = retainedOperations[storageKey] || read(storageKey);
        if (previous) {
          var recovered = await request('/contracts', json('PUT', previous.body));
          form = contractForms[input.documentId] = Object.assign({}, form, recovered, { sourceRefs: recovered.sourceRefs || previous.body.sourceRefs });
          remove(storageKey); delete retainedOperations[storageKey];
          if (canonical(previous.body.settings) === canonical(input.settings) && canonical(previous.body.sourceRefs) === canonical(refs)) return recovered;
        }
        var body = { documentId: input.documentId, expectedRevision: form.revision, settings: input.settings, clientBaseline: form.clientBaseline,
          sourceRefs: refs };
        var pending = operation(input.documentId, 'contract-settings', body);
        var saved = await request('/contracts', json('PUT', pending.entry.body));
        contractForms[input.documentId] = Object.assign({}, form, saved, { sourceRefs: saved.sourceRefs || body.sourceRefs });
        remove(pending.storageKey); delete retainedOperations[pending.storageKey]; return saved;
      }
      if (parsed.pathname === '/api/contract' && options.method === 'POST') {
        var input = JSON.parse(options.body), form = contractForms[input.documentId];
        if (!form) throw new Error('Откройте настройки договора заново');
        var body = { documentId: input.documentId, expectedRevision: form.revision, clientBaseline: form.clientBaseline,
          sourceRefs: form.sourceRefs };
        var pending = operation(input.documentId, 'contract', body);
        var file = await publishJob('/contract', pending);
        return { downloadUrl: file.downloadUrl, filename: file.fileName };
      }
      throw new Error('KP_LEGACY_ENDPOINT_UNSUPPORTED');
    }
    var api = {
      request: legacyRequest, apiRequest: request, save: save, create: create, upload: upload, generatePdf: generatePdf, previewState: previewState, mediaUrl: mediaUrl,
      localDraftKey: function () { return key(currentId, 'draft:' + (current?.revision ?? 'loading') + (viewingVersion ? ':version:' + viewingVersion : '')); },
      documentsCacheKey: prefix + 'document-labels',
      isEditable: function () { return current?.canEdit === true && !viewingVersion && !paused; },
      isPaused: function () { return paused; },
      hasUnsavedChanges: function (state) { return !!current && (canonical(state) !== confirmedState || canonical(current.fx) !== confirmedFx); },
      getDocument: function () { return current; },
      focusDocument: remember,
      getDocumentId: function () { return currentId; },
      initialState: function (defaults) { var value = copy(defaults); value.items = []; value.order = { number: '', date: '', validUntil: '', project: '' }; value.client = { name: '', contact: '' }; return value; },
      attachEditor: function (adapter) { editor = adapter; },
      reportError: function (error) { emit({ type: 'error', message: error.message || 'Не удалось открыть КП' }); },
      applyPermissions: function () {
        if (typeof document === 'undefined') return;
        var editable = api.isEditable();
        document.body.classList.toggle('crm-loading', !current);
        document.querySelectorAll('.editor-scroll input,.editor-scroll textarea,.editor-scroll select,.editor-scroll button,.js-docs-save').forEach(function (element) { element.disabled = !editable; });
        document.querySelectorAll('[data-path="order.number"],[data-path="client.name"],[data-path="client.contact"],.url-input').forEach(function (element) { element.readOnly = true; });
        document.querySelectorAll('.js-contract').forEach(function (button) { button.disabled = !current || !!viewingVersion || paused; button.title = viewingVersion ? 'Для договора выберите текущую редакцию КП' : ''; });
        var banner = document.getElementById('crmReadOnly');
        if (banner) { banner.hidden = editable; banner.textContent = !current ? 'КП ещё не загружено. Обновите страницу или вернитесь к списку.' : viewingVersion ? 'Просмотр сохранённой версии. Для изменений восстановите её как текущую.' : paused ? 'Завершите изменение клиента.' : current.isArchive || !current.project ? 'Архивное КП доступно только для просмотра.' : 'КП доступно только для просмотра: проект находится вне статуса «Лид».'; }
      },
      handleCommand: async function (command) {
        if (!editor) return;
        if (command.type === 'flush') { await ensureSaved(); return; }
        if (command.type === 'pause') { paused = command.value === true; api.applyPermissions(); if (!paused && current?.canEdit && api.hasUnsavedChanges(editor.getState())) await editor.ensureSaved(); return; }
        if (command.type === 'client') {
          if (!current?.canEdit || viewingVersion) throw new Error('КП доступно только для просмотра');
          var client = command.client, state = editor.getState();
          state.client = Object.assign({}, state.client, { crmId: client.id, crmSnapshot: Object.assign({}, client.snapshot, { id: client.id }),
            name: client.isTemporary ? '' : client.label, contact: client.isTemporary ? '' : client.snapshot.phone });
          current = Object.assign({}, current, { client: { id: client.id, label: client.label } }); documents[currentId] = current;
          paused = false; editor.applyState(state); await editor.ensureSaved(); api.applyPermissions(); return;
        }
        if (command.type === 'fx') {
          if (!api.isEditable()) throw new Error('КП доступно только для просмотра');
          current.fx = command.fx; await editor.ensureSaved(); return;
        }
        if (command.type === 'version') {
          if (!command.versionId) { var doc = remember(await request('/documents/' + encodeURIComponent(currentId))); publish(doc); return; }
          await ensureSaved();
          var result = await request('/documents/' + encodeURIComponent(currentId) + '/versions/' + encodeURIComponent(command.versionId));
          viewingVersion = command.versionId; current = result.document;
          publish(result.document); emit({ type: 'document', document: current, versionId: viewingVersion }); return;
        }
        if (command.type === 'restore') {
          var live = documents[currentId];
          if (!live?.canEdit || !viewingVersion) throw new Error('Версию можно восстановить только в «Лиде»');
          var pending = operation(currentId, 'restore:' + viewingVersion, { expectedRevision: live.revision });
          var doc = await request('/documents/' + encodeURIComponent(currentId) + '/versions/' + encodeURIComponent(viewingVersion) + '/restore', json('POST', (pending.entry || pending.previous).body));
          remove(pending.storageKey); delete retainedOperations[pending.storageKey];
          viewingVersion = null; remember(doc); publish(doc); return;
        }
      }
    };
    return api;
  };
}));
