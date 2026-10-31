(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kp-list.js'), require('./kp-local-state.js'));
  else {
    var bootstrap = JSON.parse(document.getElementById('peroCrmBootstrap').textContent);
    root.PeroCrmKp = factory(root.PeroKpList, root.PeroKpLocalState)(bootstrap, { fetch: root.fetch.bind(root),
      storage: root.PeroKpLocalState.create({ actorId: bootstrap.actorId, indexedDB: root.indexedDB,
        legacyStorage: (function () { try { return root.localStorage; } catch (_) { return null; } })(),
        onError: function (message) { var banner = document.getElementById('crmStorageStatus'); if (banner) { banner.hidden = false; banner.textContent = message; } } }),
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
}(typeof self !== 'undefined' ? self : this, function (list, localState) {
  'use strict';
  return function createCrmTransport(bootstrap, dependencies) {
    if (!bootstrap || bootstrap.apiBase !== '/api/kp' || !bootstrap.documentId || !bootstrap.actorId) throw new Error('KP_BOOTSTRAP_INVALID');
    var fetcher = dependencies.fetch, storage = dependencies.storage, emit = dependencies.emit || function () {};
    var currentId = bootstrap.documentId, documents = {}, current = null, viewingVersion = null, uploaded = new Set();
    var editor, paused = false, contractOpen = false, saveQueue = Promise.resolve(), contractForms = {}, retainedOperations = {};
    var confirmedState = null, confirmedFx = null, confirmedDocument = null, activeDraft = null;
    var clock = dependencies.clock || localState.createClock(dependencies.monotonic);
    var clientIntent = null, focusGeneration = 0, activeUploads = new Set();
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
    async function operation(id, kind, body) {
      var storageKey = key(id, 'operation:' + kind), previous = retainedOperations[storageKey] || read(storageKey);
      var fingerprint = JSON.stringify(body);
      if (previous && previous.fingerprint !== fingerprint) return { previous: previous, storageKey: storageKey };
      var entry = previous || { fingerprint: fingerprint, body: Object.assign({ operationId: uuid() }, body), editId: activeDraft?.editId };
      if (storage.prepare) await storage.prepare(id);
      if (storage.claimOperation) entry = JSON.parse(await storage.claimOperation(storageKey, JSON.stringify(entry)));
      if (entry.fingerprint !== fingerprint) return { previous: entry, storageKey: storageKey };
      retainedOperations[storageKey] = entry; if (!storage.claimOperation) write(storageKey, entry);
      if (storage.flush) await storage.flush();
      return { entry: entry, storageKey: storageKey };
    }
    async function request(path, options) {
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new Error('KP_API_PATH_INVALID');
      var started = clock.read();
      var response = await fetcher(bootstrap.apiBase + path, Object.assign({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }, options));
      clock.sample(response.headers?.get('X-KP-Server-Time'), started);
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) { var error = new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Не удалось выполнить запрос'); error.status = response.status; error.data = data; throw error; }
      return data;
    }
    function json(method, body) { return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
    function remember(doc, acceptedClientIntent) {
      if (!doc || !doc.id || !Number.isSafeInteger(doc.revision) || !doc.state || !Array.isArray(doc.state.items)) throw new Error('Некорректный ответ сохранения КП');
      if (currentId !== doc.id) activeDraft = null;
      if (arguments.length < 2 || currentId !== doc.id) {
        focusGeneration++;
        activeUploads.forEach(function (controller) { controller.abort(); });
        clientIntent = null;
      } else if (clientIntent === acceptedClientIntent) clientIntent = null;
      confirmedDocument = copy(doc);
      documents[doc.id] = doc; currentId = doc.id; current = doc; viewingVersion = null;
      confirmedState = canonical(doc.state); confirmedFx = canonical(doc.fx);
      // Ответ старого сохранения не отменяет более поздний явный выбор клиента.
      if (clientIntent) current = documents[doc.id] = Object.assign({}, doc, { client: copy(clientIntent.client) });
      var staged = read(key(doc.id, 'uploads:' + doc.revision));
      uploaded = new Set(Array.isArray(staged) ? staged.filter(function (id) { return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id); }).slice(0, 400) : []);
      emit({ type: 'document', document: current, versionId: null });
      return current;
    }
    function acknowledgeUploads(doc) {
      var referenced = new Set();
      doc.state.items.forEach(function (item) { ['image', 'image2'].forEach(function (field) { if (typeof item[field] === 'string' && item[field].startsWith('kp-media:')) referenced.add(item[field].slice(9)); }); });
      uploaded.forEach(function (id) { if (referenced.has(id)) uploaded.delete(id); });
      if (current) remove(key(current.id, 'uploads:' + current.revision));
      write(key(doc.id, 'uploads:' + doc.revision), Array.from(uploaded));
    }
    function isRejectedSave(error) {
      return error?.status === 400 && ['KP_REQUEST_INVALID', 'KP_PRICING_INVALID', 'KP_RATE_REQUIRED', 'KP_DATE_REQUIRED'].includes(error.data?.error?.code);
    }
    async function requestSave(id, path, body) {
      try { return await request(path, json('PUT', body)); }
      catch (error) {
        if (isRejectedSave(error)) {
          var storageKey = key(id, 'operation:save');
          remove(storageKey); delete retainedOperations[storageKey];
        }
        throw error;
      }
    }
    async function replay(id, path, pending) {
      var data = await requestSave(id, path, pending.body);
      if (data?.id === currentId && data.revision < current.revision) {
        var stale = new Error('Подтверждена прежняя редакция КП'); stale.status = 409;
        stale.data = { error: { code: 'KP_REVISION_CHANGED' } }; throw stale;
      }
      remove(key(id, 'operation:save')); delete retainedOperations[key(id, 'operation:save')];
      return data;
    }
    function saveRevisionConflict(error) {
      return error?.status === 409 && ['KP_REVISION_CHANGED', 'KP_CONFLICT'].includes(error.data?.error?.code);
    }
    function bundle(doc) { return { state: copy(doc.state), fx: copy(doc.fx ?? null), client: copy(doc.client ?? null) }; }
    async function latestDocument(id) {
      var latest = await request('/documents/' + encodeURIComponent(id));
      if (latest?.id !== id || !Number.isSafeInteger(latest.revision) || !Array.isArray(latest.state?.items) || currentId !== id || latest.revision < (current?.revision ?? 0))
        throw new Error('Не удалось подтвердить текущую редакцию КП');
      return latest;
    }
    function persistDraft() {
      if (activeDraft) write(key(currentId, 'draft'), activeDraft);
    }
    function noteEdit(state) {
      if (!api.isEditable() || !confirmedDocument) return;
      var local = { state: copy(state), fx: copy(current.fx ?? null), client: copy(current.client ?? null) };
      if (activeDraft && canonical(activeDraft.local) === canonical(local)) return;
      if (!api.hasUnsavedChanges(state)) { activeDraft = null; remove(key(currentId, 'draft')); return; }
      var time = clock.now();
      activeDraft = { schema: 2, editId: uuid(), baseRevision: confirmedDocument.revision,
        editedAt: Math.max(time ?? (Date.parse(confirmedDocument.updatedAt) || 0) + 1, (activeDraft?.editedAt || 0) + 0.001), local: local };
      persistDraft();
    }
    function acknowledgeDraft(doc, editId) {
      if (activeDraft?.editId === editId) { activeDraft = null; remove(key(doc.id, 'draft')); }
      else if (activeDraft) { activeDraft.baseRevision = doc.revision; activeDraft.followsRevision = doc.revision; persistDraft(); }
    }
    async function refreshCurrent(provided) {
      if (viewingVersion || paused || contractOpen || !current) return current;
      var id = currentId, latest = provided || await latestDocument(id);
      if (storage.prepare) await storage.prepare(id, latest);
      if (storage.refresh) await storage.refresh(id);
      if (currentId !== id) throw new Error('Открыто другое КП');
      var stored = read(key(id, 'draft')), candidate = activeDraft;
      if (stored && (!candidate || stored.editedAt > candidate.editedAt)) candidate = stored;
      var pending = retainedOperations[key(id, 'operation:save')] || read(key(id, 'operation:save'));
      if (pending?.editId && candidate && candidate.editId !== pending.editId && latest.revision > pending.body.expectedRevision) {
        try {
          var proof = await request('/operations/' + encodeURIComponent(pending.body.operationId));
          if (proof.operationId === pending.body.operationId && proof.result?.revision === latest.revision && proof.result?.id === id) candidate.followsRevision = latest.revision;
        } catch (error) { if (error.status !== 404) throw error; }
      }
      // Прежний черновик сохраняет текст, но не отменяет отдельную серверную смену клиента.
      if (candidate?.local && latest.revision > current.revision && current?.client?.id !== latest.client?.id) {
        candidate.local.client = copy(latest.client);
        candidate.local.state.client = copy(latest.state.client);
        clientIntent = null;
      }
      var winner = localState.localWins(candidate, latest);
      var unchanged = current.revision === latest.revision && canonical(bundle(confirmedDocument)) === canonical(bundle(latest));
      if (!unchanged || !winner && activeDraft || winner && candidate?.editId !== activeDraft?.editId) publish(remember(latest));
      if (winner) {
        activeDraft = candidate; restoreDraftContext(candidate.local);
        if (editor?.getState && editor.applyState && canonical(editor.getState()) !== canonical(candidate.local.state)) {
          var applied = editor.applyState(copy(candidate.local.state));
          if (applied) { activeDraft.local.state = copy(applied); persistDraft(); }
        }
      } else { activeDraft = null; remove(key(id, 'draft')); }
      return current;
    }
    function reconcile() {
      var next = saveQueue.catch(function () {}).then(function () { return refreshCurrent(); });
      saveQueue = next; return next;
    }
    async function recoverSave(pending, retries) {
      var id = currentId;
      try {
        var proof = await request('/operations/' + encodeURIComponent(pending.body.operationId));
        if (proof.operationId !== pending.body.operationId || proof.kind !== 'document.save' || proof.result?.id !== id) throw new Error('Не совпал результат сохранения');
      } catch (error) { if (error.status !== 404 || error.data?.error?.code !== 'KP_OPERATION_NOT_FOUND') throw error; }
      remove(key(id, 'operation:save')); delete retainedOperations[key(id, 'operation:save')];
      await refreshCurrent();
      if (!api.hasUnsavedChanges(editor?.getState ? editor.getState() : current.state)) return current;
      if (retries >= 1) throw new Error('КП снова изменилось на сервере. Актуальные данные загружены');
      return saveNow(editor?.getState ? editor.getState() : activeDraft.local.state, null, saveContext(), retries + 1);
    }
    function restoreDraftContext(local) {
      if (!api.isEditable() || !local || typeof local !== 'object') throw new Error('Черновик нельзя восстановить в этой редакции');
      if (local.fx !== undefined) current.fx = copy(local.fx);
      if (Object.prototype.hasOwnProperty.call(local, 'client')) {
        current.client = copy(local.client);
        clientIntent = (current.client?.id ?? null) !== (confirmedDocument.client?.id ?? null) ? { client: copy(current.client) } : null;
      }
    }
    function ratePreview(snapshot) {
      var currency = ({ '$': 'USD', '€': 'EUR', '₽': 'RUB', 'BYN': 'BYN', 'USD': 'USD', 'EUR': 'EUR', 'RUB': 'RUB' })[snapshot.currency];
      if (!currency) throw new Error('Выберите валюту КП');
      if (current.fx?.currency === currency) return current.fx;
      var date = String(snapshot.order?.date || ''), parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
      var isoDate = parts ? parts[3] + '-' + parts[2] + '-' + parts[1] : date;
      return { currency: currency, date: isoDate, rate: currency === 'BYN' ? '1' : '', source: 'MANUAL' };
    }
    async function rateForState(snapshot) {
      var preview = ratePreview(snapshot);
      if (current.fx?.currency === preview.currency) return current.fx;
      var quote = await request('/rates?currency=' + preview.currency + '&date=' + encodeURIComponent(preview.date));
      return quote.fx;
    }
    async function saveNow(state, fxIntent, context, retries) {
      retries = retries || 0;
      if (!current?.canEdit || viewingVersion || paused) throw new Error('КП доступно только для просмотра');
      if (currentId !== context.id) throw new Error('Открыто другое КП. Повторите сохранение');
      var id = currentId, path = '/documents/' + encodeURIComponent(id);
      var stored = retainedOperations[key(id, 'operation:save')] || read(key(id, 'operation:save'));
      if (stored) {
        try {
          var confirmed = await replay(id, path, stored);
          acknowledgeDraft(confirmed, stored.editId); acknowledgeUploads(confirmed); remember(confirmed, context.clientIntent);
          if (activeDraft) restoreDraftContext(activeDraft.local);
          else if (canonical(state) === canonical(confirmed.state) && !clientIntent) return current;
        } catch (error) {
          if (saveRevisionConflict(error)) return recoverSave(stored, retries);
          if (!isRejectedSave(error)) throw error;
        }
      }
      await refreshCurrent();
      state = activeDraft?.local.state || current.state;
      if (!api.hasUnsavedChanges(state) && !context.force) return current;
      var snapshot = copy(state), editId = activeDraft?.editId, intent = clientIntent;
      var body = { proposalId: id, expectedRevision: current.revision, state: snapshot, fx: await rateForState(snapshot) };
      if (current.client) body.clientId = current.client.id;
      var pending = await operation(id, 'save', body);
      if (pending.previous) return saveNow(state, null, saveContext(), retries);
      var result;
      try { result = await requestSave(id, path, pending.entry.body); }
      catch (error) { if (saveRevisionConflict(error)) return recoverSave(pending.entry, retries); throw error; }
      remove(pending.storageKey); delete retainedOperations[pending.storageKey];
      acknowledgeDraft(result, editId); acknowledgeUploads(result); remember(result, intent);
      if (activeDraft) restoreDraftContext(activeDraft.local);
      return current;
    }
    function saveContext() { return { id: currentId, clientIntent: clientIntent }; }
    function save(state) {
      noteEdit(state);
      var context = Object.assign(saveContext(), { force: !api.hasUnsavedChanges(state) });
      var next = saveQueue.catch(function () {}).then(function () { return saveNow(state, null, context); });
      saveQueue = next; return next.catch(function (error) { emit({ type: 'error', message: error.message }); throw error; });
    }
    async function ensureSaved() {
      if (!current) throw new Error('КП ещё не загружено');
      if (viewingVersion || !current.canEdit) return current;
      if (paused) throw new Error('Завершите изменение клиента');
      var saved = await editor.ensureSaved();
      if (!saved || !saved.id || !Number.isSafeInteger(saved.revision)) throw new Error('КП не сохранено. Проверьте данные и повторите');
      if (retainedOperations[key(currentId, 'operation:save')] || read(key(currentId, 'operation:save'))) saved = await save(editor.getState ? editor.getState() : saved.state);
      return saved;
    }
    function publish(doc) { if (editor?.applyDocument) editor.applyDocument(doc, !!viewingVersion); api.applyPermissions(); }
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
      var jobId = job?.id, delay = 750;
      if (typeof jobId !== 'string' || !jobId) throw new Error('Некорректный ответ задания');
      while (job.state !== 'SUCCEEDED') {
        if (job.state === 'FAILED' || job.state === 'CANCELLED') { var error = new Error(job.error || 'Не удалось сформировать документ'); error.knownTerminalJob = true; throw error; }
        if (job.state !== 'PENDING' && job.state !== 'PROCESSING') throw new Error('Некорректный ответ задания');
        await new Promise(function (resolve) { setTimeout(resolve, delay); });
        try {
          var refreshed = await request('/jobs/' + encodeURIComponent(jobId));
          if (refreshed?.id !== jobId) throw new Error('Не совпало задание документа');
          job = refreshed; delay = 750;
        } catch (error) {
          if (!(error instanceof TypeError) && !['AbortError', 'TimeoutError'].includes(error?.name) &&
            error?.status !== 429 && !(error?.status >= 500 && error.status <= 599)) throw error;
          delay = Math.min(delay * 2, 5000);
        }
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
      var body = { proposalId: saved.id, expectedRevision: saved.revision }, storageKey = key(saved.id, 'operation:pdf');
      var previous = retainedOperations[storageKey] || read(storageKey), pending = await operation(saved.id, 'pdf', body);
      var prior = (pending.entry || pending.previous).body, path = '/documents/' + encodeURIComponent(saved.id) + '/pdf';
      var changed = prior.proposalId !== body.proposalId || prior.expectedRevision !== body.expectedRevision, result, unaccepted;
      function retire() { remove(pending.storageKey); delete retainedOperations[pending.storageKey]; }
      try { result = await publishJob(path, pending); }
      catch (error) {
        if (error.knownTerminalJob === true) { if (!previous) throw error; }
        else if (error.status === 409 && error.data?.error?.code === 'KP_REVISION_CHANGED') {
          try {
            var recorded = await request('/operations/' + encodeURIComponent(prior.operationId));
            if (recorded.operationId !== prior.operationId || recorded.kind !== 'pdf' || !recorded.result?.id) throw error;
            result = await poll(recorded.result); retire(); emit({ type: 'versions-changed' });
          } catch (lookupError) {
            if (lookupError.knownTerminalJob === true && previous) retire();
            else if (lookupError.status === 404 && lookupError.data?.error?.code === 'KP_OPERATION_NOT_FOUND') unaccepted = error;
            else throw lookupError;
          }
        } else throw error;
      }
      if (result && !changed) return result;
      // Новая версия допустима только для явно запрошенной и всё ещё актуальной ревизии.
      var latest = await request('/documents/' + encodeURIComponent(saved.id));
      if (latest?.id !== body.proposalId || latest.revision !== body.expectedRevision || unaccepted &&
        (!previous || prior.proposalId !== body.proposalId || !Number.isSafeInteger(prior.expectedRevision) || prior.expectedRevision >= body.expectedRevision)) {
        var conflict = unaccepted || new Error('КП изменилось. Обновите данные КП и повторите действие');
        conflict.status = 409; throw conflict;
      }
      retire();
      return publishJob(path, await operation(saved.id, 'pdf', body));
    }
    async function create() {
      var date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date());
      var state = { items: [], order: { number: '', date: date, validUntil: '', project: '' }, client: { name: '', contact: '' },
        currency: 'BYN', discount: 0, discountMode: 'percent', delivery: { mode: 'total', total: 0, visible: false, items: [] } };
      var pending = await operation('new', 'create', { state: state });
      var doc = await request('/documents', json('POST', (pending.entry || pending.previous).body));
      remove(pending.storageKey); delete retainedOperations[pending.storageKey]; remember(doc); emit({ type: 'navigate', documentId: doc.id }); return doc;
    }
    async function upload(original, optimized, options) {
      options = options || {};
      if (!current?.canEdit || viewingVersion || paused) throw new Error('КП доступно только для просмотра');
      var id = currentId, generation = focusGeneration, controller = new AbortController();
      if (options.documentId && options.documentId !== id) throw new Error('Загрузка относится к другому КП');
      function abort() { controller.abort(); }
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
      function checkContext() {
        if (controller.signal.aborted || currentId !== id || focusGeneration !== generation || !api.isEditable()) {
          var error = new Error('Загрузка фото отменена: редакция КП изменилась'); error.name = 'AbortError'; throw error;
        }
      }
      activeUploads.add(controller);
      try {
        checkContext();
        // Уже начатое сохранение сначала подтверждает ревизию для загрузки.
        await saveQueue.catch(function () {});
        checkContext();
        var pendingSave = retainedOperations[key(id, 'operation:save')] || read(key(id, 'operation:save'));
        if (pendingSave) {
          try {
            var confirmed = await replay(id, '/documents/' + encodeURIComponent(id), pendingSave);
            checkContext();
            var latestFx = canonical(current.fx) !== confirmedFx ? copy(current.fx) : undefined;
            acknowledgeUploads(confirmed); remember(confirmed, undefined);
            if (latestFx !== undefined) current.fx = latestFx;
          } catch (error) {
            if (saveRevisionConflict(error)) {
              var context = saveContext(), snapshot = editor?.getState ? editor.getState() : current.state;
              await recoverSave(pendingSave, 0);
            } else if (!isRejectedSave(error)) throw error;
          }
          checkContext();
        }
        var body = new FormData(); body.set('file', original); body.set('optimized', optimized);
        body.set('expectedRevision', String(current.revision)); body.set('operationId', uuid());
        var result = await request('/documents/' + encodeURIComponent(id) + '/media', { method: 'POST', body: body, signal: controller.signal });
        checkContext();
        if (!result.reference || result.reference !== 'kp-media:' + result.mediaId || !/^kp-media:[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(result.reference)) throw new Error('Некорректный ответ загрузки');
        uploaded.add(result.mediaId); write(key(id, 'uploads:' + current.revision), Array.from(uploaded)); return result.reference;
      } finally { activeUploads.delete(controller); options.signal?.removeEventListener('abort', abort); }
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
        if (!options.method || options.method === 'GET') { var doc = await request('/documents/' + encodeURIComponent(id)); if (storage.prepare) await storage.prepare(id, doc); documents[id] = doc; return doc; }
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
        var pending = await operation(input.documentId, 'contract-settings', body);
        var saved = await request('/contracts', json('PUT', pending.entry.body));
        contractForms[input.documentId] = Object.assign({}, form, saved, { sourceRefs: saved.sourceRefs || body.sourceRefs });
        remove(pending.storageKey); delete retainedOperations[pending.storageKey]; return saved;
      }
      if (parsed.pathname === '/api/contract' && options.method === 'POST') {
        var input = JSON.parse(options.body), form = contractForms[input.documentId];
        if (!form) throw new Error('Откройте настройки договора заново');
        var body = { documentId: input.documentId, expectedRevision: form.revision, clientBaseline: form.clientBaseline,
          sourceRefs: form.sourceRefs };
        var pending = await operation(input.documentId, 'contract', body);
        var file = await publishJob('/contract', pending);
        return { downloadUrl: file.downloadUrl, filename: file.fileName };
      }
      throw new Error('KP_LEGACY_ENDPOINT_UNSUPPORTED');
    }
    var api = {
      request: legacyRequest, apiRequest: request, save: save, create: create, upload: upload, generatePdf: generatePdf, previewState: previewState, mediaUrl: mediaUrl,
      reconcile: reconcile, noteEdit: noteEdit, persistDraft: persistDraft,
      localDraftKey: function () { return key(currentId, 'draft'); },
      documentsCacheKey: prefix + 'document-labels',
      restoreDraftContext: restoreDraftContext,
      isEditable: function () { return current?.canEdit === true && !viewingVersion && !paused; },
      isPaused: function () { return paused; },
      hasUnsavedChanges: function (state) { return !!current && (!!clientIntent || canonical(state) !== confirmedState || canonical(current.fx) !== confirmedFx); },
      getDocument: function () { return current; },
      focusDocument: remember,
      acknowledgeHydration: function (doc, state) {
        if (current?.id === doc.id && current.revision === doc.revision && !viewingVersion) confirmedState = canonical(state);
      },
      getDocumentId: function () { return currentId; },
      initialState: function (defaults) { var value = copy(defaults); value.items = []; value.order = { number: '', date: '', validUntil: '', project: '' }; value.client = { name: '', contact: '' }; return value; },
      attachEditor: function (adapter) { editor = adapter; },
      setContractOpen: function (open) { contractOpen = open === true; emit({ type: 'contract-open', open: contractOpen }); },
      reportError: function (error) { emit({ type: 'error', message: error.message || 'Не удалось открыть КП' }); },
      applyPermissions: function () {
        if (typeof document === 'undefined') return;
        var editable = api.isEditable();
        document.body.classList.toggle('crm-loading', !current);
        document.querySelectorAll('.editor-scroll input,.editor-scroll textarea,.editor-scroll select,.editor-scroll button,.js-docs-save').forEach(function (element) { element.disabled = !editable; });
        document.querySelectorAll('[data-path="order.number"],[data-path="client.name"],[data-path="client.contact"],.url-input').forEach(function (element) { element.readOnly = true; });
        document.querySelectorAll('.js-contract').forEach(function (button) { button.disabled = !current || !!viewingVersion || paused; button.title = viewingVersion ? 'Для договора выберите текущую редакцию КП' : ''; });
        var banner = document.getElementById('crmReadOnly');
        if (banner) { banner.hidden = editable; banner.textContent = !current ? 'КП ещё не загружено. Обновите страницу или вернитесь к списку.' : viewingVersion ? 'Просмотр сохранённой версии. Для изменений восстановите её как текущую.' : paused ? 'Завершите изменение клиента.' : !current.project ? 'КП не связано с проектом. Для редактирования требуется привязка к проекту.' : 'КП доступно только для просмотра: проект находится вне статуса «Лид».'; }
      },
      handleCommand: async function (command) {
        if (!editor || !current) throw new Error('Редактор ещё загружается');
        if (contractOpen && command.type !== 'contract') throw new Error('Закройте форму договора перед изменением КП');
        if (command.type === 'pdf' || command.type === 'contract') {
          if (viewingVersion) throw new Error('Для генерации выберите текущую редакцию КП');
          if (paused) throw new Error('Завершите изменение клиента');
          if (command.type === 'pdf') await editor.generatePdf();
          else await editor.openContract();
          return;
        }
        if (command.type === 'flush') { await ensureSaved(); return; }
        if (command.type === 'pause') { paused = command.value === true; api.applyPermissions(); if (!paused && current?.canEdit && api.hasUnsavedChanges(editor.getState())) await editor.ensureSaved(); return; }
        if (command.type === 'client') {
          if (!(current?.canChangeClient ?? current?.canEdit) || viewingVersion) throw new Error('Клиент недоступен для изменения');
          if (current.canEdit) {
            await saveQueue.catch(function () {});
            if (api.hasUnsavedChanges(editor.getState()) || retainedOperations[key(currentId, 'operation:save')] || read(key(currentId, 'operation:save'))) await editor.ensureSaved();
          }
          var selectionBody = { expectedRevision: current.revision, expectedClientId: current.client.id, clientId: command.client.id };
          var pendingSelection = await operation(currentId, 'client', selectionBody);
          var selection = pendingSelection.entry || pendingSelection.previous;
          try {
            var selectedDocument = await request('/documents/' + encodeURIComponent(currentId) + '/client', json('PATCH', selection.body));
            remove(pendingSelection.storageKey); delete retainedOperations[pendingSelection.storageKey];
            clientIntent = null; activeDraft = null; remove(key(currentId, 'draft'));
            remember(selectedDocument); editor.applyState(copy(selectedDocument.state)); api.applyPermissions();
            if (selectedDocument.client?.id !== command.client.id) throw new Error('Предыдущая смена клиента подтверждена. Повторите новый выбор');
          } catch (selectionError) {
            if (selectionError.status >= 400 && selectionError.status < 500) {
              try { await request('/operations/' + encodeURIComponent(selection.body.operationId)); }
              catch (proofError) { if (proofError.status === 404) { remove(pendingSelection.storageKey); delete retainedOperations[pendingSelection.storageKey]; } }
            }
            throw selectionError;
          }
          return;
        }
        if (command.type === 'fx') {
          if (!api.isEditable()) throw new Error('КП доступно только для просмотра');
          current.fx = command.fx; noteEdit(editor.getState ? editor.getState() : current.state); await editor.ensureSaved(); return;
        }
        if (command.type === 'rate-preview') {
          if (!api.isEditable()) throw new Error('КП доступно только для просмотра');
          emit({ type: 'rate-preview', fx: ratePreview(editor.getState()) }); return;
        }
        if (command.type === 'version') {
          if (!command.versionId) { viewingVersion = null; await refreshCurrent(); return; }
          await ensureSaved();
          var result = await request('/documents/' + encodeURIComponent(currentId) + '/versions/' + encodeURIComponent(command.versionId));
          viewingVersion = command.versionId; current = result.document;
          publish(result.document); emit({ type: 'document', document: current, versionId: viewingVersion }); return;
        }
        if (command.type === 'restore') {
          var live = documents[currentId];
          if (!live?.canEdit || !viewingVersion) throw new Error('Версию можно восстановить только в «Лиде»');
          var pending = await operation(currentId, 'restore:' + viewingVersion, { expectedRevision: live.revision });
          var doc = await request('/documents/' + encodeURIComponent(currentId) + '/versions/' + encodeURIComponent(viewingVersion) + '/restore', json('POST', (pending.entry || pending.previous).body));
          remove(pending.storageKey); delete retainedOperations[pending.storageKey];
          viewingVersion = null; remember(doc); publish(doc); return;
        }
      }
    };
    return api;
  };
}));
