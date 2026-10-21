(function () {
    'use strict';

    var M = window.ContractModel, R = window.SheetRender, editor;
    var modal, content, saveStatus, errorBox, downloadButton, closeButton;
    var documentId, primaryState, settings, profiles = [], proposals = [], documents = [];
    var saveTimer, saveQueue = Promise.resolve(), revision = 0, savedRevision = -1, opening = false, generating = false, openToken = 0, returnFocus;
    var memoryDrafts = {};
    var contractHistory = [], historyError = null, historyLoading = false, contractCanEdit = false, formContext = null;
    var presetPeriods = [10, 15, 20, 30, 35, 45, 55, 60, 90, 120];
    var paymentConditions = ['При подписании договора', 'Аванс при подписании договора', 'После изготовления, перед доставкой', 'После монтажа и подписания акта'];

    function esc(value) { return R.esc(value); }
    function valueAt(path) { return path.split('.').reduce(function (value, part) { return value == null ? '' : value[part]; }, settings); }
    function setAt(path, value) {
        var parts = path.split('.'), current = settings;
        for (var i = 0; i < parts.length - 1; i++) { if (!current[parts[i]]) current[parts[i]] = {}; current = current[parts[i]]; }
        current[parts[parts.length - 1]] = value;
    }
    function input(label, path, type, attributes) {
        var id = 'contract-' + path.replace(/[^a-zA-Z0-9]/g, '-');
        return '<div class="contract-field"><label for="' + id + '">' + label + '</label><input id="' + id + '" data-contract-path="' + path + '" type="' + (type || 'text') + '" value="' + esc(valueAt(path)) + '" ' + (attributes || '') + '></div>';
    }
    function select(label, path, options, selectedValue, extra) {
        var id = 'contract-' + path.replace(/[^a-zA-Z0-9]/g, '-');
        return '<div class="contract-field"><label for="' + id + '">' + label + '</label><select id="' + id + '" data-contract-path="' + path + '" ' + (extra || '') + '>' + options.map(function (option) { return '<option value="' + esc(option[0]) + '"' + (String(option[0]) === String(selectedValue == null ? valueAt(path) : selectedValue) ? ' selected' : '') + '>' + esc(option[1]) + '</option>'; }).join('') + '</select></div>';
    }
    function textarea(label, path, rows) {
        var id = 'contract-' + path.replace(/[^a-zA-Z0-9]/g, '-');
        return '<div class="contract-field"><label for="' + id + '">' + label + '</label><textarea id="' + id + '" data-contract-path="' + path + '" rows="' + (rows || 2) + '">' + esc(valueAt(path)) + '</textarea></div>';
    }
    function termFields(prefix, terms) {
        var units = [['working', 'Рабочие дни'], ['calendar', 'Календарные дни']];
        var warrantyPath = prefix + 'warrantyMonths', warranty = Number(terms.warrantyMonths);
        var known = [6, 12, 18, 24, 36, 60].indexOf(warranty) >= 0;
        return '<div class="contract-grid contract-grid-terms">' +
            '<div class="contract-period"><div class="contract-field"><label>Изготовление</label><input aria-label="Срок изготовления" type="number" min="1" max="3650" list="contractPeriodPresets" data-contract-path="' + prefix + 'productionDays" value="' + esc(terms.productionDays) + '"></div>' + select('Единица срока изготовления', prefix + 'productionUnit', units, terms.productionUnit) + '</div>' +
            '<div class="contract-period"><div class="contract-field"><label>Доставка и монтаж</label><input aria-label="Срок доставки и монтажа" type="number" min="1" max="3650" list="contractPeriodPresets" data-contract-path="' + prefix + 'installationDays" value="' + esc(terms.installationDays) + '"></div>' + select('Единица срока монтажа', prefix + 'installationUnit', units, terms.installationUnit) + '</div>' +
            '<div class="contract-field"><label>Гарантия</label><select aria-label="Гарантия" data-contract-warranty="' + warrantyPath + '">' + [6, 12, 18, 24, 36, 60].map(function (n) { return '<option value="' + n + '"' + (warranty === n ? ' selected' : '') + '>' + n + ' ' + M.plural(n, ['месяц', 'месяца', 'месяцев']) + '</option>'; }).join('') + '<option value="custom"' + (!known ? ' selected' : '') + '>Другой срок</option></select><input aria-label="Гарантия в месяцах" data-contract-path="' + warrantyPath + '" data-warranty-custom="' + warrantyPath + '" type="number" min="1" max="3650" value="' + esc(terms.warrantyMonths) + '"' + (known ? ' hidden' : '') + '></div></div>';
    }
    function setError(message) {
        errorBox.textContent = message || '';
        errorBox.hidden = !message;
    }
    function request(url, options) { return window.PeroCrmKp.request(url, options); }
    function remember() { if (documentId && settings && formContext) memoryDrafts[documentId] = { settings: M.clone(settings), clientBaseline: formContext.clientBaseline, revision: formContext.revision }; }
    function changed() {
        revision++;
        remember();
        saveStatus.textContent = 'Есть изменения…';
        saveStatus.className = 'contract-save-status';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { persist().catch(function () {}); }, 500);
        refreshSummary();
    }
    function persist() {
        if (!contractCanEdit || !settings || !documentId || savedRevision === revision) return saveQueue;
        var currentRevision = revision, snapshot = M.clone(settings), id = documentId, state = primaryState;
        saveStatus.textContent = 'Сохраняем…';
        saveQueue = saveQueue.catch(function () {}).then(function () {
            return request('/api/contracts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: id, settings: snapshot, primaryState: state }) });
        }).then(function (result) {
            if (id === documentId) { formContext = Object.assign({}, formContext, result); remember(); }
            if (id === documentId) {
                savedRevision = currentRevision;
                saveStatus.textContent = savedRevision === revision ? 'Настройки сохранены' : 'Есть изменения…';
                saveStatus.className = 'contract-save-status saved';
            }
        }).catch(function (error) {
            saveStatus.textContent = 'Не удалось сохранить';
            saveStatus.className = 'contract-save-status failed';
            setError(error.message);
            throw error;
        });
        return saveQueue;
    }
    function flushSave() { clearTimeout(saveTimer); return persist(); }
    function render() {
        content.innerHTML = '<fieldset class="contract-fields">' +
            '<section class="contract-section"><h3>Договор и исполнитель</h3><div class="contract-grid">' + input('Номер договора', 'number') + input('Дата договора', 'date', 'date') + input('Город', 'city') + select('Исполнитель', 'contractorProfileId', profiles.map(function (p) { return [p.id, p.label]; })) + '</div><div id="contractProfileInfo" class="contract-profile-info"></div>' + textarea('Предмет договора', 'subject') + '</section>' +
            '<section class="contract-section"><h3>КП в договоре</h3><div id="contractProposalList"></div><div class="contract-add-proposal"><div class="contract-field"><label for="contractSearch">Найти дополнительное КП</label><input id="contractSearch" type="search" placeholder="Номер или клиент"></div><div class="contract-field"><label for="contractAdditional">Сохранённые КП</label><select id="contractAdditional"></select></div><button type="button" class="btn btn-ghost" id="contractAddProposal">Добавить КП</button></div><p id="contractDocsMessage" class="contract-hint"></p><label id="contractCustomerConfirmation" class="contract-checkbox" hidden><input type="checkbox" data-contract-path="sameCustomerConfirmed"' + (settings.sameCustomerConfirmed ? ' checked' : '') + '>Все выбранные КП относятся к одному заказчику</label></section>' +
            '<section class="contract-section"><h3>Заказчик и адрес объекта</h3><div class="contract-grid">' + select('Тип заказчика', 'customer.type', [['individual', 'Физическое лицо'], ['soleProprietor', 'ИП'], ['organization', 'Организация']]) + input('ФИО / наименование', 'customer.name', 'text', 'autocomplete="name"') + input('Телефон', 'customer.phone', 'tel', 'autocomplete="tel"') + input('Email', 'customer.email', 'email', 'autocomplete="email"') + '</div>' + textarea('Адрес доставки и монтажа', 'deliveryAddress') + textarea('Адрес регистрации / юридический адрес', 'customer.registrationAddress') +
            '<div id="contractLegalCustomer"><div class="contract-grid">' + input('ИНН / УНП', 'customer.taxId') + input('ОГРН / ОГРНИП / регистрационный номер', 'customer.registrationId') + '</div>' + textarea('Банковские реквизиты заказчика', 'customer.bankDetails') + '</div><div id="contractOrganization"><div class="contract-grid">' + input('ФИО подписанта', 'customer.representative') + input('Должность подписанта', 'customer.position') + '</div>' + input('Основание полномочий', 'customer.authority', 'text', 'list="contractAuthorityPresets"') + '</div><details class="contract-extra"><summary>Дополнительные реквизиты и подпись</summary>' + textarea('Паспорт / документ физического лица', 'customer.passport') + input('ФИО в строке подписи', 'customer.signature', 'text', 'placeholder="Заполняется автоматически из имени или подписанта"') + '</details></section>' +
            '<section class="contract-section"><h3>Сроки и гарантия</h3>' + termFields('', settings) + '<p class="contract-hint">Сроки отсчитываются от подписания договора. Для отдельных КП можно включить свои условия в списке выше.</p></section>' +
            '<section class="contract-section"><div class="contract-section-head"><h3>График платежей</h3><div class="contract-payment-count"><label for="contractPaymentCount">Количество платежей</label><select id="contractPaymentCount">' + Array.from({ length: 10 }, function (_, i) { return '<option value="' + (i + 1) + '"' + (settings.payments.length === i + 1 ? ' selected' : '') + '>' + (i + 1) + '</option>'; }).join('') + '</select></div></div><div id="contractPaymentList"></div><p class="contract-hint">Выберите проценты или сумму каждого платежа. При смене количества график заполняется заново.</p></section>' +
            '<section class="contract-section contract-summary"><h3>Перед скачиванием</h3><div id="contractSummary"></div><p class="contract-hint">Приложения сохраняют исходные условия КП. Сроки, гарантия и порядок оплаты определяются договором.</p></section></fieldset>' +
            '<datalist id="contractPeriodPresets">' + presetPeriods.map(function (n) { return '<option value="' + n + '"></option>'; }).join('') + '</datalist><datalist id="contractPaymentConditions">' + paymentConditions.map(function (condition) { return '<option value="' + esc(condition) + '"></option>'; }).join('') + '</datalist><datalist id="contractAuthorityPresets"><option value="Устава"></option><option value="Доверенности"></option></datalist>';
        renderProfile(); renderCustomer(); renderSources(); renderPayments(); renderOptions(); refreshSummary();
    }
    function renderProfile() {
        var profile = profiles.filter(function (p) { return p.id === settings.contractorProfileId; })[0];
        var element = document.getElementById('contractProfileInfo');
        if (!profile) { element.textContent = ''; return; }
        element.innerHTML = '<strong>' + esc(profile.name || profile.label) + '</strong>' + (profile.address ? '<span>' + esc(profile.address) + '</span>' : '') + (profile.placeholder ? '<span class="contract-placeholder-note">Реквизиты РФ пока не заполнены. В DOCX будут явные плейсхолдеры.</span>' : '');
    }
    function renderCustomer() {
        document.getElementById('contractLegalCustomer').hidden = settings.customer.type === 'individual';
        document.getElementById('contractOrganization').hidden = settings.customer.type !== 'organization';
    }
    function renderSources() {
        var html = settings.proposalIds.map(function (id, index) {
            var source = proposals.filter(function (p) { return p.id === id; })[0];
            var state = source && source.state, terms = M.termsFor(settings, id), override = settings.proposalOverrides[id];
            return '<div class="contract-proposal"><div class="contract-proposal-head"><div><strong>' + (state ? 'КП №' + esc(state.order && state.order.number || 'без номера') : 'КП недоступно') + '</strong><span>' + (state ? esc(state.client && state.client.name || '') + (state.order && state.order.date ? ' · ' + esc(state.order.date) : '') : 'Удалите его из договора или проверьте соединение') + '</span></div><div class="contract-proposal-actions"><span>Приложение №' + (index + 1) + '</span>' + (index > 0 ? '<button type="button" data-contract-move="' + index + '" data-direction="-1"' + (index === 1 ? ' disabled' : '') + ' aria-label="Переместить КП вверх">↑</button><button type="button" data-contract-move="' + index + '" data-direction="1"' + (index === settings.proposalIds.length - 1 ? ' disabled' : '') + ' aria-label="Переместить КП вниз">↓</button><button type="button" data-contract-remove="' + esc(id) + '" aria-label="Убрать КП из договора">×</button>' : '<span class="contract-primary-tag">Основное</span>') + '</div></div><label class="contract-checkbox"><input type="checkbox" data-contract-override="' + esc(id) + '"' + (override ? ' checked' : '') + '>Свои сроки и гарантия для этого КП</label>' + (override ? termFields('proposalOverrides.' + id + '.', terms) : '') + '</div>';
        }).join('');
        document.getElementById('contractProposalList').innerHTML = html;
    }
    function renderOptions() {
        var search = document.getElementById('contractSearch').value.toLowerCase().trim();
        var available = documents.filter(function (doc) { return settings.proposalIds.indexOf(doc.id) < 0 && (!search || String(doc.name || '').toLowerCase().indexOf(search) >= 0); });
        document.getElementById('contractAdditional').innerHTML = '<option value="">Выберите КП</option>' + available.map(function (doc) { return '<option value="' + esc(doc.id) + '">' + esc(doc.name || 'КП без названия') + '</option>'; }).join('');
        document.getElementById('contractDocsMessage').textContent = available.length ? '' : documents.length ? 'Подходящих КП не найдено' : 'Список сохранённых КП пока не загружен';
    }
    function renderPayments() {
        document.getElementById('contractPaymentList').innerHTML = settings.payments.map(function (payment, index) {
            return '<div class="contract-payment"><div class="contract-payment-title">Платёж ' + (index + 1) + '</div><div class="contract-grid contract-payment-values">' + select('Задать платёж', 'payments.' + index + '.mode', [['percent', 'В процентах'], ['amount', 'Суммой']], payment.mode, 'data-payment-mode="' + index + '"') + input(payment.mode === 'percent' ? 'Доля, %' : 'Сумма', 'payments.' + index + '.value', 'number', 'min="0.01" step="0.01"') + '<div class="contract-payment-result"><span data-payment-result="' + index + '"></span><button type="button" class="contract-fill-balance" data-contract-balance="' + index + '">Заполнить остатком</button></div></div>' + input('Когда оплачивается', 'payments.' + index + '.condition', 'text', 'list="contractPaymentConditions"') + '</div>';
        }).join('');
    }
    function currentSubject() {
        return M.subjectFor(settings.proposalIds.map(function (id) { return proposals.filter(function (source) { return source.id === id; })[0]; }).filter(Boolean));
    }
    function updateSubject(previous) {
        if (settings.subject !== previous) return;
        settings.subject = currentSubject();
        document.getElementById('contract-subject').value = settings.subject;
    }
    function refreshSummary() {
        if (!settings || !document.getElementById('contractSummary')) return;
        var summary = M.summarize(settings, proposals);
        summary.payments.forEach(function (payment, index) {
            var element = content.querySelector('[data-payment-result="' + index + '"]');
            if (element) element.textContent = Number.isFinite(payment.amountMinor) ? M.money(payment.amountMinor, summary.currency) + (payment.mode === 'amount' ? ' · ' + R.fmt(payment.percent) + '%' : '') : '—';
        });
        document.getElementById('contractCustomerConfirmation').hidden = !summary.customerMismatch;
        var balanceLabel = summary.balanceMinor === 0 ? 'Сумма платежей совпадает со стоимостью договора' : Number.isFinite(summary.balanceMinor) ? 'Нераспределённый остаток: ' + M.money(summary.balanceMinor, summary.currency) : 'Заполните суммы всех платежей';
        var names = summary.sources.map(function (source) { return '<span>Приложение №' + source.appendix + ' — КП №' + esc(source.number || 'без номера') + ' <b>' + M.money(source.totalMinor, summary.currency) + '</b></span>'; }).join('');
        document.getElementById('contractSummary').innerHTML = '<div class="contract-total"><span>Общая стоимость</span><strong>' + M.money(summary.totalMinor, summary.currency) + '</strong></div><div class="contract-summary-list">' + names + '<span>Приложение №' + summary.projectAppendix + ' — Проект изделия</span><span>Приложение №' + summary.actAppendix + ' — Акт приёмки</span></div><div class="contract-balance' + (summary.balanceMinor === 0 ? ' balanced' : '') + '">' + balanceLabel + '</div>' + (summary.errors.length ? '<ul class="contract-validation">' + summary.errors.map(function (error) { return '<li>' + esc(error.message) + '</li>'; }).filter(function (value, index, all) { return all.indexOf(value) === index; }).join('') + '</ul>' : '');
    }

    async function loadSources() {
        proposals = [{ id: documentId, updatedAt: 0, state: primaryState }];
        for (var i = 1; i < settings.proposalIds.length; i++) {
            var id = settings.proposalIds[i];
            try {
                var source = await request('/api/documents?id=' + encodeURIComponent(id));
                proposals.push({ id: id, updatedAt: source.updatedAt, state: source.state });
            } catch (error) { setError(error.message); }
        }
    }
    function renderContractHistory() {
        var target = document.getElementById('contractHistoryList');
        if (!target) return;
        target.innerHTML = historyLoading ? '<p class="contract-hint">Загружаем выпуски…</p>' : historyError ? '<p class="contract-hint">' + esc(historyError) + '</p>' : contractHistory.length ? contractHistory.map(function (version) {
            var stamp = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(version.createdAt));
            return '<p><a href="/api/kp/artifacts/' + encodeURIComponent(version.docxArtifactId) + '/download" download>' + esc(stamp + ' · ' + version.fileName) + '</a></p>';
        }).join('') : '<p class="contract-hint">Выпущенных договоров пока нет</p>';
    }
    async function loadContractHistory() {
        var id = documentId, token = openToken;
        historyLoading = true; renderContractHistory();
        try {
            var response = await request('/api/contracts/history?documentId=' + encodeURIComponent(id));
            if (id !== documentId || token !== openToken) return;
            contractHistory = response.versions || []; historyError = null;
        } catch (error) { if (id !== documentId || token !== openToken) return; contractHistory = []; historyError = error.message; }
        historyLoading = false; renderContractHistory();
    }
    async function open() {
        if (opening || generating || !modal.hidden) return;
        opening = true;
        var token = ++openToken;
        settings = null; contractCanEdit = false; formContext = null; contractHistory = []; historyError = null;
        renderContractHistory();
        documents = [];
        returnFocus = document.activeElement;
        modal.hidden = false;
        if (editor.onOpenChange) editor.onOpenChange(true);
        document.body.classList.add('contract-open');
        content.innerHTML = '<div class="contract-loading"><span class="spinner"></span><p>Подставляем данные КП и последние настройки…</p></div>';
        saveStatus.textContent = '';
        setError('');
        downloadButton.disabled = true;
        closeButton.focus();
        try {
            var saved = await editor.ensureSaved();
            if (!saved) throw new Error('Сначала сохраните основное КП');
            documentId = saved.id;
            loadContractHistory();
            if (token !== openToken) return;
            primaryState = editor.getState();
            var stored = null;
            try {
                stored = await request('/api/contracts?documentId=' + encodeURIComponent(documentId));
                profiles = stored.profiles; formContext = stored; contractCanEdit = stored.canEdit === true;
            } catch (error) {
                profiles = error.data && error.data.profiles || [{ id: 'pero-by', label: 'Перо.Лайв (РБ)' }, { id: 'pero-ru', label: 'ПЕРО.МАРКЕТ (РФ)', placeholder: true }];
                setError(error.message);
            }
            var draft = memoryDrafts[documentId];
            var matchingDraft = draft && stored && draft.clientBaseline === stored.clientBaseline && draft.revision === stored.revision;
            settings = M.normalizeSettings(matchingDraft ? draft.settings : stored && stored.settings, primaryState, documentId);
            if (settings.proposalIds[0] !== documentId) settings.proposalIds = [documentId].concat(settings.proposalIds.filter(function (id) { return id !== documentId; }));
            revision = 0; savedRevision = -1;
            await loadSources();
            if (token !== openToken) return;
            render();
            downloadButton.disabled = !contractCanEdit;
            content.querySelector('fieldset').disabled = !contractCanEdit;
            document.querySelector('.contract-dialog-body').scrollTop = 0;
            document.getElementById('contract-number').focus();
            request('/api/documents').then(function (data) {
                if (token !== openToken) return;
                documents = data.documents || [];
                renderOptions();
            }).catch(function (error) { if (token === openToken) setError(error.message); });
            persist().catch(function () {});
        } catch (error) {
            setError(error.message);
            content.innerHTML = '<p class="contract-hint">Не удалось подготовить форму. Закройте окно и повторите попытку.</p>';
        } finally { opening = false; }
    }
    async function close() {
        if (generating) return;
        ++openToken;
        clearTimeout(saveTimer);
        remember();
        if (settings && !opening) await flushSave().catch(function () {});
        modal.hidden = true;
        if (editor.onOpenChange) editor.onOpenChange(false);
        document.body.classList.remove('contract-open');
        if (returnFocus && returnFocus.focus) returnFocus.focus();
    }
    async function addProposal() {
        var selectElement = document.getElementById('contractAdditional'), id = selectElement.value;
        if (!id || settings.proposalIds.indexOf(id) >= 0) return;
        var button = document.getElementById('contractAddProposal');
        button.disabled = true;
        setError('');
        try {
            var source = await request('/api/documents?id=' + encodeURIComponent(id));
            var previousSubject = currentSubject();
            proposals.push({ id: id, updatedAt: source.updatedAt, state: source.state });
            settings.proposalIds.push(id);
            updateSubject(previousSubject);
            settings.sameCustomerConfirmed = false;
            renderSources(); renderOptions(); changed();
        } catch (error) { setError(error.message); }
        finally { button.disabled = false; }
    }
    async function download() {
        if (!contractCanEdit) { setError('Договор доступен только для просмотра'); return; }
        if (generating || opening || !settings) return;
        setError('');
        if (editor.getDocumentId() !== documentId) { setError('Основное КП изменилось. Закройте окно и откройте настройки договора заново'); return; }
        var previousSummary = M.summarize(settings, proposals), previousSubject = currentSubject();
        primaryState = editor.getState();
        proposals.filter(function (source) { return source.id === documentId; })[0].state = primaryState;
        updateSubject(previousSubject);
        var refreshedSummary = M.summarize(settings, proposals);
        refreshSummary();
        if (previousSummary.totalMinor !== refreshedSummary.totalMinor) {
            changed();
            setError('Стоимость основного КП изменилась. Проверьте обновлённый расчёт и повторите скачивание');
            return;
        }
        var checked = M.validate(settings, proposals, profiles);
        content.querySelectorAll('.contract-invalid').forEach(function (element) { element.classList.remove('contract-invalid'); });
        if (checked.errors.length) {
            setError(checked.errors[0].message);
            var field = content.querySelector('[data-contract-path="' + checked.errors[0].field + '"]');
            if (field) { field.classList.add('contract-invalid'); field.focus(); }
            return;
        }
        generating = true;
        downloadButton.disabled = true;
        closeButton.disabled = true;
        modal.querySelector('[data-contract-close]').disabled = true;
        content.querySelector('fieldset').disabled = true;
        downloadButton.textContent = 'Готовим договор и приложения…';
        try {
            await flushSave();
            var versions = {};
            proposals.forEach(function (source) { versions[source.id] = source.updatedAt; });
            var data = await request('/api/contract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: documentId, settings: settings, primaryState: primaryState, sourceVersions: versions }) });
            var anchor = document.createElement('a');
            anchor.href = data.downloadUrl;
            anchor.download = data.filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            editor.notify('Договор готов. Скачивание началось');
            loadContractHistory();
        } catch (error) {
            if (error.status === 409) { await loadSources(); settings.sameCustomerConfirmed = false; renderSources(); refreshSummary(); }
            setError(error.message);
        } finally {
            generating = false;
            downloadButton.disabled = !contractCanEdit;
            closeButton.disabled = false;
            modal.querySelector('[data-contract-close]').disabled = false;
            content.querySelector('fieldset').disabled = !contractCanEdit;
            downloadButton.textContent = 'Скачать DOCX';
        }
    }
    function initialize() {
        var root = document.createElement('div');
        root.className = 'contract-modal'; root.id = 'contractModal'; root.hidden = true;
        root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'contractDialogTitle');
        root.innerHTML = '<div class="contract-dialog"><div class="contract-dialog-head"><div><h2 id="contractDialogTitle">Сгенерировать договор</h2><p>Данные из КП уже подставлены. Уточните реквизиты и условия.</p></div><button type="button" class="contract-close" id="contractClose" aria-label="Закрыть настройки договора">×</button></div><div class="contract-dialog-body"><div id="contractError" class="contract-error" role="alert" hidden></div><div id="contractContent"></div></div><details class="contract-section contract-extra"><summary>Ранее выпущенные договоры · Москва</summary><div id="contractHistoryList"></div></details><div class="contract-dialog-foot"><span id="contractSaveStatus" class="contract-save-status" aria-live="polite"></span><div class="contract-dialog-actions"><button type="button" class="btn btn-ghost" data-contract-close>Отмена</button><button type="button" class="btn btn-contract" id="contractDownload">Скачать DOCX</button></div></div></div>';
        document.body.appendChild(root);
        modal = root; content = document.getElementById('contractContent'); saveStatus = document.getElementById('contractSaveStatus'); errorBox = document.getElementById('contractError'); downloadButton = document.getElementById('contractDownload'); closeButton = document.getElementById('contractClose');
        document.querySelectorAll('.js-contract').forEach(function (button) { button.addEventListener('click', open); });
        closeButton.addEventListener('click', close);
        modal.querySelector('[data-contract-close]').addEventListener('click', close);
        downloadButton.addEventListener('click', download);
        modal.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key !== 'Tab') return;
            var elements = Array.from(modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary')).filter(function (element) { return element.getClientRects().length; });
            var first = elements[0], last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        content.addEventListener('input', function (event) {
            var target = event.target;
            if (target.id === 'contractSearch') { renderOptions(); return; }
            var path = target.getAttribute('data-contract-path');
            if (!path || target.tagName === 'SELECT' || target.type === 'checkbox') return;
            setAt(path, target.type === 'number' ? target.value === '' ? '' : Number(target.value) : target.value);
            if (path === 'customer.name' && !settings.customer.signature) content.querySelector('[data-contract-path="customer.signature"]').placeholder = target.value;
            if (M.termKeys.indexOf(path) >= 0) renderSources();
            changed();
        });
        content.addEventListener('change', function (event) {
            var target = event.target, path = target.getAttribute('data-contract-path');
            if (target.id === 'contractPaymentCount') { settings.payments = M.splitPayments(Number(target.value)); renderPayments(); changed(); return; }
            if (target.hasAttribute('data-contract-warranty')) {
                path = target.getAttribute('data-contract-warranty');
                var custom = content.querySelector('[data-warranty-custom="' + path + '"]');
                custom.hidden = target.value !== 'custom';
                if (custom.hidden) { setAt(path, Number(target.value)); custom.value = target.value; }
                else custom.focus();
                if (M.termKeys.indexOf(path) >= 0) renderSources();
                changed(); return;
            }
            if (target.hasAttribute('data-contract-override')) {
                var id = target.getAttribute('data-contract-override');
                if (target.checked) settings.proposalOverrides[id] = M.clone(M.termsFor(settings, id));
                else delete settings.proposalOverrides[id];
                renderSources(); changed(); return;
            }
            if (!path || target.tagName !== 'SELECT' && target.type !== 'checkbox') return;
            if (target.hasAttribute('data-payment-mode')) {
                var index = Number(target.getAttribute('data-payment-mode'));
                var summary = M.summarize(settings, proposals), payment = summary.payments[index];
                settings.payments[index].value = target.value === 'amount' ? payment.amountMinor / 100 : Math.round(payment.percent * 100) / 100;
                settings.payments[index].mode = target.value;
                renderPayments();
            } else setAt(path, target.type === 'checkbox' ? target.checked : target.value);
            if (path === 'customer.type') renderCustomer();
            if (path === 'contractorProfileId') renderProfile();
            if (M.termKeys.indexOf(path) >= 0) renderSources();
            changed();
        });
        content.addEventListener('click', function (event) {
            var target = event.target.closest('button');
            if (!target) return;
            if (target.id === 'contractAddProposal') { addProposal(); return; }
            if (target.hasAttribute('data-contract-remove')) {
                var id = target.getAttribute('data-contract-remove');
                var previousSubject = currentSubject();
                settings.proposalIds = settings.proposalIds.filter(function (value) { return value !== id; });
                proposals = proposals.filter(function (source) { return source.id !== id; });
                updateSubject(previousSubject);
                delete settings.proposalOverrides[id]; settings.sameCustomerConfirmed = false;
                renderSources(); renderOptions(); changed(); return;
            }
            if (target.hasAttribute('data-contract-move')) {
                var index = Number(target.getAttribute('data-contract-move')), next = index + Number(target.getAttribute('data-direction'));
                if (next < 1 || next >= settings.proposalIds.length) return;
                var previousSubject = currentSubject();
                var temp = settings.proposalIds[index]; settings.proposalIds[index] = settings.proposalIds[next]; settings.proposalIds[next] = temp;
                updateSubject(previousSubject);
                renderSources(); changed(); return;
            }
            if (target.hasAttribute('data-contract-balance')) {
                var index = Number(target.getAttribute('data-contract-balance')), summary = M.summarize(settings, proposals);
                var others = summary.payments.reduce(function (sum, payment, i) { return sum + (i === index ? 0 : payment.amountMinor); }, 0);
                var balance = summary.totalMinor - others;
                if (balance <= 0) { setError('Остаток должен быть больше нуля. Уменьшите другие платежи'); return; }
                settings.payments[index].mode = 'amount'; settings.payments[index].value = balance / 100;
                renderPayments(); changed();
            }
        });
    }

    window.ContractEditor = { init: function (bridge) { editor = bridge; initialize(); }, open: open };
}());
