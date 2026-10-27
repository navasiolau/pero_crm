(function () {
'use strict';
var CRM = window.PeroCrmKp;
if (!CRM) throw new Error('KP_TRANSPORT_REQUIRED');
var DOCS_LS_KEY = CRM.documentsCacheKey;

var R = window.SheetRender;
var LOGO = R.LOGO;
var PRODUCT_FIELDS = R.PRODUCT_FIELDS;
var esc = R.esc;
var fmt = R.fmt;
var totalsOf = R.totalsOf;
var sheetHTML = R.sheetHTML;
var pdfFileName = R.pdfFileName;

function P(title, outer, inner, hinges, drawers, lighting) {
    return { title: title || '', outer: outer || '', inner: inner || '', hinges: hinges || '', drawers: drawers || '', lighting: lighting || '' };
}

var DEFAULT = {
    header: {
        company: 'Перо Лайв', tagline: 'Мебель по индивидуальным заказам. Легкость во всём',
        phone: '+7 919 763-13-73', phone2: '+375 (29) 798-51-09',
        email: 'livepero@gmail.com', site: 'pero.by', instagram: '@Pero_mebel'
    },
    order: { number: '196', date: '28.07.2026', validUntil: '11.08.2026', project: 'Меблировка квартиры' },
    client: { name: 'Екатерина', contact: '' },
    discount: 0,
    discountMode: 'percent',
    currency: '$',
    warrantyMonths: 12,
    payment: 'Оплата: предоплата 70 %, остаток — после монтажа',
    totalNote: 'включая доставку и монтаж',
    intro: 'Благодарим за обращение. Ниже — расчёт по вашему проекту. Утверждённый вариант визуализации прикрепим после согласования.',
    items: [
        {
            name: 'Откос, стол, шкаф-стелаж', description: '', size: 'Согласно ТЗ', image: '', price: 1380, note: '',
            products: [
                P('Шкаф книжный', 'ЛДСП Egger Дуб Честер Кофейный', '', 'Blum Tip-on', '', ''),
                P('Стол письменный', 'ЛДСП Egger Дуб Честер Кофейный', '', '', '2 выдвижных ящика на шариковых направляющих', ''),
                P('Откосы', 'ЛДСП Egger Дуб Честер Кофейный', '', '', '', '')
            ]
        },
        {
            name: 'Шкаф плательный',
            description: 'По данной позиции: правая секция шкафа состоит из трёх ярусов ящиков (т.е. за дверцами) и полок. Утверждённый вариант прикрепим после согласования правильной версии. Просчитана правильная версия.',
            size: 'Согласно ТЗ 2080/600', image: '', price: 2186, note: '',
            products: [
                P('Шкаф плательный', 'ЛДСП Kronospan Миндаль 0564 PE', '', 'Blum Tip-on', '10 выдвижных ящиков Boyard, штанга Boyard овальная — 2 шт.', ''),
                P('Полка открытая', 'ЛДСП Egger Дуб Честер Кофейный', '', '', '', '')
            ]
        },
        {
            name: 'Книжный шкаф со столом косметическим', description: '', size: 'Согласно ТЗ', image: '', price: 805, note: '',
            products: [
                P('Стол косметический', 'ЛДСП Egger Дуб Честер Кофейный', '', '', '2 выдвижных ящика на шариковых направляющих', ''),
                P('Полка открытая', 'ЛДСП Kronospan Миндаль 0564 PE', '', '', '', '')
            ]
        },
        {
            name: 'Шкаф под стиралку; открытый шкаф, тумба', description: '', size: 'Согласно ТЗ', image: '', price: 1530, note: '',
            products: [
                P('Шкаф под стиральную машину', 'ЛДСП Kronospan Миндаль 0564 PE', '', 'Blum Tip-on', 'Выдвижная корзина для белья — 2 шт.', ''),
                P('Полка открытая', 'ЛДСП Egger Дуб Честер Кофейный', '', '', '', ''),
                P('Тумба под мойку', 'ЛДСП Egger Дуб Честер Кофейный', '', '', '2 выдвижных ящика Boyard', '')
            ]
        },
        {
            name: 'С/у отделка инсталляции, тумба, зеркало, +шкаф', description: '', size: 'Согласно ТЗ', image: '', price: 1195, note: '',
            products: [
                P('Отделка инсталляции + шкаф', 'ЛДСП Kronospan Миндаль 0564 PE', '', 'Фурнитура Blum', '', ''),
                P('Тумба под раковину', 'ЛДСП Kronospan Керамический Красный K098 SU', 'Столешница и фасад — эмаль (цвет подбирается)', 'Фурнитура Blum', '', ''),
                P('Зеркало', 'Серебро 4 мм', '', '', '', '')
            ]
        }
    ],
    delivery: { mode: 'total', items: [], total: 1150, visible: true },
    manager: { name: 'Суботка Роман Петрович', role: 'Директор', phone: '+375 33 308-63-08' },
    footer: 'ООО «ПеРо Лайв» · УНП 291231014 · 225305 Брестская обл., г.Кобрин, ул.Железнодорожная, д.50 · Гарантия — 12 месяцев.'
};

var state = CRM.initialState(DEFAULT);

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function setPath(o, path, val) {
    var p = path.split('.'), cur = o;
    for (var i = 0; i < p.length - 1; i++) {
        var indexed = /^\d+$/.test(p[i + 1]), next = cur[p[i]];
        if (!next || typeof next !== 'object' || Array.isArray(next) && !indexed) next = cur[p[i]] = indexed ? [] : {};
        cur = next;
    }
    cur[p[p.length - 1]] = val;
}
function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
function plural(n, a, b, c) { n = Math.abs(n) % 100; var d = n % 10; if (n > 10 && n < 20) return c; if (d > 1 && d < 5) return b; if (d === 1) return a; return c; }
function deepMerge(base, extra) {
    for (var k in extra) {
        if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k] && typeof base[k] === 'object') { deepMerge(base[k], extra[k]); }
        else { base[k] = extra[k]; }
    }
    return base;
}
function normItem(it) {
    if (!it.id) it.id = crypto.randomUUID();
    it.products = Array.isArray(it.products) ? it.products : [];
    if (typeof it.note !== 'string') it.note = '';
    it.qty = R.qtyOf(it);
    if (typeof it.dbl !== 'boolean') it.dbl = false;
    return it;
}

var sheet = document.getElementById('sheet');
var itemsList = document.getElementById('itemsList');
var totalAmt = document.getElementById('totalAmt');
var toastEl = document.getElementById('toast');
var viewport = document.getElementById('viewport');
var scaleEl = document.getElementById('scale');
var zval = document.getElementById('zval');
var pagesChip = document.getElementById('pagesChip');
var deliveryEditor = document.getElementById('deliveryEditor');
var discToggle = document.getElementById('discToggle');
var docsCurrent = document.getElementById('docsCurrent');
var docsBtn = document.querySelector('.js-docs-toggle');
var docsSaveBtn = document.querySelector('.js-docs-save');
var docsPanel = document.getElementById('docsPanel');
var docsList = document.getElementById('docsList');
var confirmModal = document.getElementById('confirmModal');
var confirmTitle = document.getElementById('confirmTitle');
var confirmText = document.getElementById('confirmText');
var confirmCancel = document.getElementById('confirmCancel');
var confirmOk = document.getElementById('confirmOk');
var busyModal = document.getElementById('busyModal');
var busyTitle = document.getElementById('busyTitle');

var currentDocId = null;

(function () {
    try {
        var fav = LOGO.replace(/currentColor/g, '#383838');
        var link = document.querySelector('link[rel="icon"]');
        if (link) link.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fav);
    } catch (e) { }
})();
var brandLogo = document.getElementById('brandLogo');
if (brandLogo) brandLogo.innerHTML = LOGO;

var generating = false;
function setPdfBtns(label, disabled) {
    document.querySelectorAll('.js-pdf').forEach(function (b) { b.textContent = label; b.disabled = !!disabled; });
}
async function genPdf(reportFailure) {
    if (generating) { if (reportFailure === true) throw new Error('PDF уже формируется'); return; }
    generating = true;
    setPdfBtns('Готовим PDF…', true);
    try {
        var file = await CRM.generatePdf();
        var anchor = document.createElement('a');
        anchor.href = file.downloadUrl; anchor.download = file.fileName;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        toast('PDF сформирован и скачан');
    } catch (error) { toast(error.message || 'Не удалось сформировать PDF', 5000); if (reportFailure === true) throw error; }
    finally { generating = false; setPdfBtns('Сгенерировать PDF', false); }
}

function productEditor(i, j, p) {
    return '<div class="prod">' +
        '<div class="prod-head">' +
        '<input data-path="items.' + i + '.products.' + j + '.title" value="' + esc(p.title) + '" placeholder="Название изделия">' +
        '<button class="ictrl ictrl-del" data-dprod="' + i + '.' + j + '" title="Удалить изделие">✕</button>' +
        '</div>' +
        PRODUCT_FIELDS.map(function (f) {
            return '<div class="f prod-f"><label class="f-label">' + f.label + '</label>' +
                '<input data-path="items.' + i + '.products.' + j + '.' + f.key + '" value="' + esc(p[f.key] || '') + '"></div>';
        }).join('') +
        '</div>';
}

function itemCard(it, i) {
    var n = state.items.length;
    var thumb = it.image ? '<img src="' + esc(CRM.mediaUrl(it.image)) + '" alt="">' : '<div class="item-thumb-ph">Фото</div>';
    var dblChecked = it.dbl ? ' checked' : '';
    return '' +
        '<div class="item-card">' +
        '<div class="item-head">' +
        '<span class="item-tag">Позиция ' + String(i + 1).padStart(2, '0') + '</span>' +
        '<label class="vis-toggle item-dbl-toggle" title="Сдвоенный режим: позиция занимает целую страницу, 2 фото слева и описание справа">' +
        '<input type="checkbox" data-path="items.' + i + '.dbl"' + dblChecked + '>' +
        '<span class="vis-toggle-box"></span>' +
        '<span class="vis-toggle-text">сдвоенная</span>' +
        '</label>' +
        '<span class="item-ctrl">' +
        '<button class="ictrl" data-mv="' + i + '" data-dir="-1" title="Выше" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
        '<button class="ictrl" data-mv="' + i + '" data-dir="1" title="Ниже" ' + (i === n - 1 ? 'disabled' : '') + '>↓</button>' +
        '<button class="ictrl" data-dup="' + i + '" title="Дублировать">⧉</button>' +
        '<button class="ictrl ictrl-del" data-del="' + i + '" title="Удалить">✕</button>' +
        '</span>' +
        '</div>' +
        '<div class="item-top">' +
        '<div class="item-thumb">' + thumb + '</div>' +
        '<div class="item-fields">' +
        '<div class="f"><label class="f-label">Название</label><input data-path="items.' + i + '.name" value="' + esc(it.name) + '"></div>' +
        '<div class="row2">' +
        '<div class="f"><label class="f-label">Размер (Д х В х Г)</label><input data-path="items.' + i + '.size" value="' + esc(it.size || '') + '" placeholder="Согласно ТЗ"></div>' +
        '<div class="f"><label class="f-label">Стоимость за шт</label><input type="number" min="0" step="10" data-path="items.' + i + '.price" value="' + esc(it.price) + '"></div>' +
        '<div class="f"><label class="f-label">Кол-во, шт</label><input type="number" min="1" step="1" data-path="items.' + i + '.qty" value="' + esc(it.qty || 1) + '"></div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="f"><label class="f-label">Описание</label><textarea rows="3" data-path="items.' + i + '.description">' + esc(it.description || '') + '</textarea></div>' +
        '<div class="mat-block">' +
        '<span class="mat-block-title">Материалы и исполнение</span>' +
        (it.products || []).map(function (p, j) { return productEditor(i, j, p); }).join('') +
        '<button class="add-prod" data-aprod="' + i + '">＋ Добавить изделие</button>' +
        '</div>' +
        '<div class="f"><label class="f-label">Примечание</label><textarea rows="2" data-path="items.' + i + '.note" placeholder="Выделяется оранжевым на листе">' + esc(it.note || '') + '</textarea></div>' +
        '<div class="f"><label class="f-label">Фото позиции</label>' +
        '<div class="photo-row">' +
        '<label class="file-btn">Загрузить<input type="file" accept="image/*" data-file-idx="' + i + '"></label>' +
        '<input class="url-input" data-path="items.' + i + '.image" readonly placeholder="Загрузите фото" value="' + (it.image ? 'Фото загружено' : '') + '">' +
        '</div>' +
        (it.dbl ?
            '<div class="photo-row photo-row-2">' +
            '<label class="file-btn">Загрузить<input type="file" accept="image/*" data-file-idx2="' + i + '"></label>' +
            '<input class="url-input" data-path="items.' + i + '.image2" readonly placeholder="Загрузите второе фото" value="' + (it.image2 ? 'Фото загружено' : '') + '">' +
            '</div>' : '') +
        '<div class="f-hint">фото вписывается целиком · хранится в облаке' + (it.dbl ? ' · доступно 2 фото на позицию' : '') + '</div>' +
        '</div>' +
        '</div>';
}

function renderItemsEditor() { itemsList.innerHTML = state.items.map(itemCard).join(''); }

function refreshThumb(card, src) {
    if (!card) return;
    card.querySelector('.item-thumb').innerHTML =
        src ? '<img src="' + esc(src) + '" alt="">' : '<div class="item-thumb-ph">Фото</div>';
}

function renderDeliveryEditor() {
    var d = state.delivery || { mode: 'total', items: [], total: 0, visible: true };
    var html = '<div class="del-mode">' +
        '<button class="del-mode-btn' + (d.mode === 'items' ? ' on' : '') + '" data-delmode="items">По пунктам</button>' +
        '<button class="del-mode-btn' + (d.mode === 'total' ? ' on' : '') + '" data-delmode="total">Общая сумма</button>' +
        '</div>';
    if (d.mode === 'items') {
        html += '<div>';
        (d.items || []).forEach(function (it, i) {
            html += '<div class="del-row">' +
                '<input class="del-name" data-path="delivery.items.' + i + '.name" value="' + esc(it.name) + '" placeholder="Название пункта">' +
                '<input class="del-price" type="number" min="0" data-path="delivery.items.' + i + '.price" value="' + esc(it.price) + '">' +
                '<button class="ictrl ictrl-del" data-ddel="' + i + '" title="Удалить пункт">✕</button>' +
                '</div>';
        });
        html += '</div><button class="add-prod" data-dadd>＋ Пункт</button>';
    } else {
        html += '<div class="f"><label class="f-label">Общая сумма</label>' +
            '<input type="number" min="0" data-path="delivery.total" value="' + esc(d.total || 0) + '"></div>';
    }
    deliveryEditor.innerHTML = html;
}

function currencySymbol() { return state.currency || '$'; }
function renderDiscToggle() {
    var isAmount = state.discountMode === 'amount';
    discToggle.textContent = isAmount ? currencySymbol() : '%';
    discToggle.classList.toggle('amount', isAmount);
    discToggle.title = isAmount
        ? 'Скидка — фиксированная сумма (' + currencySymbol() + '). Клик — переключить на проценты'
        : 'Скидка — проценты. Клик — переключить на сумму в ' + currencySymbol();
}
discToggle.addEventListener('click', function () {
    state.discountMode = state.discountMode === 'amount' ? 'percent' : 'amount';
    renderDiscToggle();
    renderSheet(); updateTotal(); scheduleSave();
});

var deliveryVisibleEl = document.getElementById('deliveryVisible');
var deliveryVisText = document.querySelector('#deliveryVisWrap .vis-toggle-text');
if (deliveryVisibleEl) {
    deliveryVisibleEl.addEventListener('change', function () {
        if (!state.delivery) state.delivery = { mode: 'total', items: [], total: 0, visible: true };
        state.delivery.visible = deliveryVisibleEl.checked;
        if (deliveryVisText) deliveryVisText.textContent = deliveryVisibleEl.checked ? 'показывается в КП' : 'скрыто в КП';
        renderSheet(); updateTotal(); scheduleSave();
    });
}

function renderSheet() {
    sheet.innerHTML = sheetHTML(CRM.previewState(state));
    CRM.applyPermissions();
    document.title = 'КП ' + (state.order.number || '—') + ' · Перо Лайв';
    requestAnimationFrame(updatePageCount);
}

function updatePageCount() {
    var pages = sheet.querySelectorAll('.page').length;
    if (pagesChip) pagesChip.textContent = pages + ' ' + plural(pages, 'страница', 'страницы', 'страниц') + ' A4';
}

function updateTotal() {
    var T = totalsOf(state);
    totalAmt.textContent = fmt(T.total) + ' ' + (state.currency || '$');
    totalAmt.classList.remove('pulse'); void totalAmt.offsetWidth; totalAmt.classList.add('pulse');
}

function syncStaticInputs() {
    document.querySelectorAll('[data-path]').forEach(function (el) {
        if (el.closest('#itemsList') || el.closest('#deliveryEditor')) return;
        var v = getPath(state, el.dataset.path);
        if (el.dataset.path === 'currency') v = v === 'USD' ? '$' : v === 'EUR' ? '€' : v === 'RUB' ? '₽' : v;
        if (el.dataset.path === 'warrantyMonths' && v == null) v = 24;
        el.value = (v == null ? '' : v);
    });
    var deliveryVisibleEl = document.getElementById('deliveryVisible');
    var deliveryVisText = document.querySelector('#deliveryVisWrap .vis-toggle-text');
    if (deliveryVisibleEl && state.delivery) {
        deliveryVisibleEl.checked = state.delivery.visible !== false;
        if (deliveryVisText) deliveryVisText.textContent = deliveryVisibleEl.checked ? 'показывается в КП' : 'скрыто в КП';
    }
}

function refreshAll() { renderItemsEditor(); renderDeliveryEditor(); renderDiscToggle(); renderSheet(); updateTotal(); }

var saveT;
var remoteSaveT;
var pendingDraftReview = null, draftReviewPromise = null;
function scheduleSave() { pruneMediaUploads(); clearTimeout(saveT); saveT = setTimeout(saveNow, 500); clearTimeout(remoteSaveT); if (CRM.isEditable() && !pendingDraftReview) remoteSaveT = setTimeout(function () { if (CRM.hasUnsavedChanges(state)) saveCurrentDoc(currentDocId, { silent: true }); }, 1200); }
function draftContext() { return typeof CRM.draftContext === 'function' ? CRM.draftContext() : null; }
function preserveDraft(reason, detail) {
    var context = draftContext();
    if (!context) return;
    localStorage.setItem(context.prefix + 'backup:' + Date.now() + ':' + crypto.randomUUID(), JSON.stringify({ schema: 1, reason: reason,
        documentId: currentDocId, updatedAt: new Date().toISOString(), context: context, state: clone(state), detail: detail }));
}
function saveNow() {
    try {
        if (!currentDocId || pendingDraftReview && !CRM.hasUnsavedChanges(state)) return;
        var context = draftContext(), key = CRM.localDraftKey(), snapshot = clone(state);
        if (context) {
            if (key !== context.prefix + context.revision) return;
            var previous = localStorage.getItem(key), previousValue = null, legacyKey = context.prefix + 'legacy-backup:' + context.revision;
            try { previousValue = JSON.parse(previous); } catch (e) { }
            if (previous && !previousValue?.schema && !localStorage.getItem(legacyKey)) localStorage.setItem(legacyKey, previous);
            localStorage.setItem(key, JSON.stringify({ schema: 1, documentId: currentDocId, revision: context.revision, updatedAt: new Date().toISOString(),
                base: { state: context.baseState, fx: context.fx, client: context.client },
                local: { state: snapshot, fx: context.localFx, client: context.localClient } }));
        } else {
            snapshot.__docId = currentDocId;
            localStorage.setItem(key, JSON.stringify(snapshot));
        }
    } catch (e) { }
}
function applyLocalDraft(data) {
    cancelMediaUploads();
    state = deepMerge(clone(DEFAULT), data);
    state.warrantyMonths = data.warrantyMonths == null ? null : data.warrantyMonths;
    state.items.forEach(normItem);
    state.items.forEach(function (it) { ['image', 'image2'].forEach(function (key) { if (typeof it[key] === 'string' && it[key].indexOf('data:') === 0) it[key] = ''; }); });
    if (!state.delivery) state.delivery = clone(DEFAULT.delivery);
    if (state.delivery.visible === undefined) state.delivery.visible = true;
    if (state.discountMode !== 'amount') state.discountMode = 'percent';
    if (state.doubleMode) state.items.forEach(function (it) { it.dbl = true; });
}
function readDraft(key, revision) {
    try {
        var value = JSON.parse(localStorage.getItem(key));
        if (!value) return null;
        if (value.schema === 1 && value.documentId === currentDocId && value.revision === revision && Array.isArray(value.local?.state?.items) && value.local.state.items.every(function (item) { return item && typeof item === 'object' && !Array.isArray(item); }))
            return { key: key, revision: revision, updatedAt: value.updatedAt, state: value.local.state, local: value.local, base: value.base };
        if (!value.schema && Array.isArray(value.items) && value.items.every(function (item) { return item && typeof item === 'object' && !Array.isArray(item); }) && (!value.__docId || value.__docId === currentDocId)) {
            var legacy = clone(value); delete legacy.__docId;
            return { key: key, revision: revision, state: legacy, legacy: true };
        }
    } catch (e) { }
    return null;
}
function loadSaved() {
    try {
        var context = draftContext(), key = CRM.localDraftKey();
        if (!context) {
            var old = JSON.parse(localStorage.getItem(key));
            if (!old || !Array.isArray(old.items) || old.__docId && old.__docId !== currentDocId) return false;
            old = clone(old); delete old.__docId; applyLocalDraft(old); return true;
        }
        if (key !== context.prefix + context.revision) return false;
        var current = readDraft(key, context.revision);
        if (current) {
            applyLocalDraft(current.state);
            if (current.local && typeof CRM.restoreDraftContext === 'function') CRM.restoreDraftContext(current.local);
            return true;
        }
        var candidates = [];
        if (typeof localStorage.key === 'function') for (var i = 0; i < localStorage.length; i++) {
            var candidateKey = localStorage.key(i);
            if (typeof candidateKey !== 'string' || !candidateKey.startsWith(context.prefix)) continue;
            var suffix = candidateKey.slice(context.prefix.length);
            if (!/^\d+$/.test(suffix) || !Number.isSafeInteger(Number(suffix))) continue;
            var candidate = readDraft(candidateKey, Number(suffix)); if (candidate) candidates.push(candidate);
        }
        candidates.sort(function (a, b) { return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || b.revision - a.revision; });
        if (candidates.length) {
            pendingDraftReview = { draft: candidates[0], remote: clone(CRM.getDocument()) };
            void reviewDraft().catch(function (error) { toast(error.message, 5000); });
        }
        return false;
    } catch (e) { return false; }
}

var mediaUploads = new Map(), mediaContext = 0;
function mediaItem(task) {
    if (task.context !== mediaContext || task.documentId !== currentDocId || task.documentId !== CRM.getDocumentId()) return null;
    return state.items.find(function (item) { return item.id === task.itemId; });
}
function pruneMediaUploads() {
    mediaUploads.forEach(function (task, key) {
        if (!mediaItem(task)) { task.controller.abort(); mediaUploads.delete(key); }
    });
}
function cancelMediaUploads() {
    mediaContext++;
    mediaUploads.forEach(function (task) { task.controller.abort(); });
    mediaUploads.clear();
}
async function awaitMediaUploads(documentId) {
    for (;;) {
        if (documentId !== currentDocId || documentId !== CRM.getDocumentId()) throw new Error('Открыто другое КП. Повторите сохранение');
        pruneMediaUploads();
        var pending = [];
        mediaUploads.forEach(function (task) {
            if (task.error) throw task.error;
            pending.push(new Promise(function (resolve) {
                function done() { task.controller.signal.removeEventListener('abort', done); resolve(); }
                if (task.controller.signal.aborted) { resolve(); return; }
                task.controller.signal.addEventListener('abort', done, { once: true });
                task.promise.then(done, done);
            }));
        });
        if (!pending.length) return;
        await Promise.all(pending);
    }
}
function cancelledPhoto() { var error = new Error('Загрузка фото отменена'); error.name = 'AbortError'; return error; }
function compressImage(file, maxSide, quality, signal) {
    return new Promise(function (resolve, reject) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        var settled = false;
        function finish(error, value) {
            if (settled) return;
            settled = true; signal.removeEventListener('abort', abort);
            img.onload = null; img.onerror = null; URL.revokeObjectURL(url);
            if (error) reject(error); else resolve(value);
        }
        function abort() { finish(cancelledPhoto()); img.src = ''; }
        if (signal.aborted) { abort(); return; }
        signal.addEventListener('abort', abort, { once: true });
        img.onload = function () {
            var w = img.width, h = img.height;
            var k = Math.min(1, maxSide / Math.max(w, h));
            w = Math.round(w * k); h = Math.round(h * k);
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            c.toBlob(function (b) {
                if (b) finish(null, new File([b], (file.name.replace(/\.\w+$/, '') || 'photo') + '.jpg', { type: 'image/jpeg' }));
                else finish(new Error('Не удалось сжать изображение'));
            }, 'image/jpeg', quality);
        };
        img.onerror = function () { finish(new Error('Не удалось прочитать файл')); };
        img.src = url;
    });
}

async function uploadToR2(file, task) {
    var optimized = await compressImage(file, 1600, 0.82, task.controller.signal);
    if (!mediaItem(task) || task.controller.signal.aborted) throw cancelledPhoto();
    return CRM.upload(file, optimized, { documentId: task.documentId, signal: task.controller.signal });
}

function handlePhotoInput(input, i, slot) {
    var f = input.files && input.files[0];
    if (!f || !state.items[i] || !CRM.isEditable()) return;
    var key = JSON.stringify([currentDocId, state.items[i].id, slot]), previous = mediaUploads.get(key);
    if (previous) previous.controller.abort();
    var task = { documentId: currentDocId, itemId: state.items[i].id, context: mediaContext, controller: new AbortController() };
    mediaUploads.set(key, task);
    var card = input.closest('.item-card');

    var previewUrl = URL.createObjectURL(f);
    if (slot === 'image') refreshThumb(card, previewUrl);
    toast('Загружаем фото в хранилище…');
    task.promise = uploadToR2(f, task).then(function (publicUrl) {
        var item = mediaItem(task);
        if (!item || mediaUploads.get(key) !== task || task.controller.signal.aborted) return;
        item[slot] = publicUrl;
        mediaUploads.delete(key);
        renderItemsEditor(); renderSheet(); scheduleSave();
        toast('Фото загружено ✓');
    }).catch(function (err) {
        if (!mediaItem(task) || mediaUploads.get(key) !== task || task.controller.signal.aborted) return;
        task.error = new Error('Не удалось загрузить фото (' + (err.message || 'ошибка') + '). Повторите загрузку или удалите позицию');
        renderItemsEditor();
        toast(task.error.message, 6000);
    }).finally(function () {
        URL.revokeObjectURL(previewUrl);
        if (input.files && input.files[0] === f) input.value = '';
    });
    return task.promise;
}

document.addEventListener('input', function (e) {
    var t = e.target, p = t.dataset.path;
    if (!p || t.closest('#itemsList')) return;
    var val = t.type === 'checkbox' ? t.checked : t.value;
    if (p === 'warrantyMonths') {
        if (t.value === '') return;
        val = t.value === '' ? null : Math.max(1, Math.round(+t.value) || 12);
        if (val != null) {
            state.footer = String(state.footer || '').replace(/Гарантия\s*[—–-]\s*\d+\s*месяц(?:а|ев)?\.?/i, 'Гарантия — ' + val + ' ' + plural(val, 'месяц', 'месяца', 'месяцев') + '.');
            var footerInput = document.querySelector('[data-path="footer"]');
            if (footerInput) footerInput.value = state.footer;
        }
    }
    setPath(state, p, val);
    renderSheet(); updateTotal(); scheduleSave();
});
document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.path === 'warrantyMonths' && t.value === '') t.value = state.warrantyMonths == null ? 24 : state.warrantyMonths;
    if (t.matches && t.matches('select[data-path]') && !t.closest('#itemsList')) {
        setPath(state, t.dataset.path, t.value);
        renderDiscToggle();
        renderSheet(); updateTotal(); scheduleSave();
    }
});

itemsList.addEventListener('input', function (e) {
    var t = e.target, p = t.dataset.path; if (!p) return;
    var val;
    if (t.type === 'number') { val = t.value === '' ? 0 : +t.value; }
    else if (t.type === 'checkbox') { val = t.checked; }
    else { val = t.value; }
    if (p.slice(-4) === '.qty') { val = R.qtyOf({ qty: val }); t.value = val; }
    setPath(state, p, val);
    if (p.slice(-6) === '.image') { refreshThumb(t.closest('.item-card'), val); }
    if (p.slice(-4) === '.dbl') { renderItemsEditor(); }
    renderSheet(); updateTotal(); scheduleSave();
});

itemsList.addEventListener('change', function (e) {
    var t = e.target;
    if (t.type !== 'file') return;
    if (t.dataset.fileIdx != null) handlePhotoInput(t, +t.dataset.fileIdx, 'image');
    else if (t.dataset.fileIdx2 != null) handlePhotoInput(t, +t.dataset.fileIdx2, 'image2');
});

itemsList.addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]');
    if (d) { state.items.splice(+d.dataset.del, 1); refreshAll(); scheduleSave(); return; }
    var dup = e.target.closest('[data-dup]');
    if (dup) {
        var i = +dup.dataset.dup;
        var copy = clone(normItem(state.items[i])); copy.id = crypto.randomUUID(); copy.name += ' (копия)';
        state.items.splice(i + 1, 0, copy);
        refreshAll(); scheduleSave(); return;
    }
    var mv = e.target.closest('[data-mv]');
    if (mv && !mv.disabled) {
        var ii = +mv.dataset.mv, j = ii + (+mv.dataset.dir);
        if (j >= 0 && j < state.items.length) {
            var t = state.items[ii]; state.items[ii] = state.items[j]; state.items[j] = t;
            refreshAll(); scheduleSave();
        }
        return;
    }
    var ap = e.target.closest('[data-aprod]');
    if (ap) {
        var ia = +ap.dataset.aprod;
        normItem(state.items[ia]).products.push(P('', '', '', '', '', ''));
        renderItemsEditor(); renderSheet(); scheduleSave();
        return;
    }
    var dp = e.target.closest('[data-dprod]');
    if (dp) {
        var parts = dp.dataset.dprod.split('.');
        state.items[+parts[0]].products.splice(+parts[1], 1);
        renderItemsEditor(); renderSheet(); scheduleSave();
    }
});

deliveryEditor.addEventListener('click', function (e) {
    var mode = e.target.closest('[data-delmode]');
    if (mode) {
        if (!state.delivery) state.delivery = { mode: 'total', items: [], total: 0 };
        var m = mode.dataset.delmode;
        if (m === 'items' && state.delivery.mode !== 'items') {
            state.delivery.mode = 'items';
            if (!(state.delivery.items || []).length) {
                state.delivery.items = [{ name: 'Доставка, выгрузка, монтаж', price: state.delivery.total || 0 }];
            }
        } else if (m === 'total') {
            state.delivery.mode = 'total';
        }
        renderDeliveryEditor(); renderSheet(); updateTotal(); scheduleSave();
        return;
    }
    var add = e.target.closest('[data-dadd]');
    if (add) {
        state.delivery.items.push({ name: '', price: 0 });
        renderDeliveryEditor(); renderSheet(); updateTotal(); scheduleSave();
        return;
    }
    var del = e.target.closest('[data-ddel]');
    if (del) {
        state.delivery.items.splice(+del.dataset.ddel, 1);
        renderDeliveryEditor(); renderSheet(); updateTotal(); scheduleSave();
    }
});

document.querySelectorAll('.js-add').forEach(function (b) {
    b.addEventListener('click', function () {
        state.items.push(normItem({ name: 'Новая позиция', description: '', size: '', image: '', price: 0, note: '', products: [] }));
        refreshAll(); scheduleSave();
        var cards = itemsList.querySelectorAll('.item-card'), last = cards[cards.length - 1];
        if (last) { var nm = last.querySelector('[data-path$=".name"]'); if (nm) { nm.focus(); nm.select(); } }
    });
});

document.querySelectorAll('.js-pdf').forEach(function (b) { b.addEventListener('click', genPdf); });

var docsLoading = false;
var docsNamesCache = {};
try {
    var dn = localStorage.getItem(DOCS_LS_KEY);
    if (dn) docsNamesCache = JSON.parse(dn) || {};
} catch (e) { docsNamesCache = {}; }

function saveDocsNamesCache() {
    try { localStorage.setItem(DOCS_LS_KEY, JSON.stringify(docsNamesCache)); } catch (e) { }
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function fmtDocStamp(updatedAt) {
    if (!updatedAt) return '';
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(updatedAt));
}

function docNumber(doc) {
    var number = '';
    if (doc.number) { number = String(doc.number); }
    else if (doc.name) {
        var m = doc.name.match(/КП №([^\s—]+)/);
        if (m) number = m[1].trim();
    } else if (doc.state && doc.state.order && String(doc.state.order.number || '').trim()) {
        number = String(doc.state.order.number).trim();
    }
    return number ? '№' + number : '';
}

function docLabel(doc) {
    var num = docNumber(doc);
    var stamp = fmtDocStamp(doc.updatedAt);
    return (num ? 'КП ' + num : 'КП №—') + (stamp ? ' · ' + stamp : '');
}

function renderDocsCurrent() {
    if (!docsCurrent) return;
    var label = currentDocId ? docsNamesCache[currentDocId] : '';
    if (currentDocId && label) {
        var m = label.match(/(№[^\s·—]+)/);
        docsCurrent.textContent = '- ' + (m ? m[1] : 'сохранено');
        docsCurrent.style.display = 'inline';
    } else if (currentDocId) {
        docsCurrent.textContent = '- сохранено';
        docsCurrent.style.display = 'inline';
    } else {
        docsCurrent.textContent = '';
        docsCurrent.style.display = 'none';
    }
}

function setDocsPanel(open) {
    docsPanel.hidden = !open;
    docsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function docsBusy(show, title) {
    busyModal.hidden = !show;
    if (show) busyTitle.textContent = title || 'Выполняем…';
}

async function loadDocsList(force) {
    if (docsLoading) return;
    docsLoading = true;
    docsList.innerHTML = '<div class="docs-loading"><span class="spinner"></span> загружаем…</div>';
    try {
        var r = await CRM.request('/api/documents');
        var data = r;
        var docs = (data && data.documents) || [];
        if (force) {
            saveDocsNamesCache();
        }
        if (!docs.length) {
            docsList.innerHTML = '<div class="docs-empty">Пока ничего не сохранено</div>';
        } else {
            docsList.innerHTML = docs.map(function (doc) {
                var active = doc.id === currentDocId;
                return '<div class="doc-row' + (active ? ' on' : '') + '" data-docid="' + esc(doc.id) + '">' +
                    '<button class="doc-open" type="button" title="' + esc(docLabel(doc)) + '">' + esc(docLabel(doc)) + '</button>' +
                    (active ? '<span class="doc-current-tag">текущее</span>' : '') +
                    (doc.project && doc.project.id ? '<a class="doc-project" href="/projects/' + encodeURIComponent(doc.project.id) + '" target="_top" title="Открыть проект">↗</a>' : '') +
                    '</div>';
            }).join('');
        }
        renderDocsSaveBtn();
    } catch (e) {
        console.error('[docs list]', e);
        docsList.innerHTML = '<div class="docs-empty">Не удалось загрузить</div>';
        toast('Не удалось загрузить список сохранённых КП', 4000);
    }
    docsLoading = false;
}

function renderDocsSaveBtn() {
    if (!docsSaveBtn) return;
    docsSaveBtn.textContent = currentDocId ? 'Сохранить текущее' : 'Сохранить как новое';
}

docsBtn.addEventListener('click', function () {
    var opening = docsPanel.hidden;
    setDocsPanel(opening);
    if (opening) loadDocsList();
});

document.addEventListener('click', function (e) {
    var widget = e.target.closest('[data-docs-widget]');
    if (!widget) setDocsPanel(false);
});

function toggleDocsConfirm(show, id, name) {
    if (show) {
        confirmModal.dataset.docid = id;
        confirmTitle.textContent = 'Удалить сохранённое КП?';
        confirmText.textContent = name;
        confirmModal.hidden = false;
    } else {
        confirmModal.dataset.docid = '';
        confirmModal.hidden = true;
    }
}

var reviewDecision = null, reviewRemoteButton = null;
function finishReview(choice) {
    if (!reviewDecision) return;
    var resolve = reviewDecision; reviewDecision = null;
    confirmModal.hidden = true; confirmOk.textContent = 'Удалить'; confirmOk.style.display = ''; confirmCancel.textContent = 'Отмена'; confirmText.style.whiteSpace = '';
    if (reviewRemoteButton) reviewRemoteButton.hidden = true;
    resolve(choice);
}
function showReview(title, text, localLabel) {
    if (reviewDecision) return Promise.resolve(null);
    if (!reviewRemoteButton) {
        reviewRemoteButton = document.createElement('button'); reviewRemoteButton.type = 'button'; reviewRemoteButton.className = 'btn btn-ghost btn-sm';
        reviewRemoteButton.textContent = 'Загрузить серверную';
        confirmCancel.parentNode.insertBefore(reviewRemoteButton, confirmCancel);
        reviewRemoteButton.addEventListener('click', function () { finishReview('remote'); });
    }
    docsBusy(false); confirmTitle.textContent = title; confirmText.textContent = text; confirmText.style.whiteSpace = 'pre-line';
    confirmOk.textContent = localLabel; confirmOk.style.display = ''; confirmCancel.textContent = 'Отмена'; reviewRemoteButton.hidden = false; confirmModal.hidden = false;
    return new Promise(function (resolve) { reviewDecision = resolve; });
}
function reviewLabel(path) {
    path = path.replace(/^state\./, '');
    var labels = { state: 'Данные КП', header: 'Шапка организации', 'header.company': 'Организация', 'header.tagline': 'Слоган',
        'order.project': 'Проект', 'order.date': 'Дата КП', 'order.validUntil': 'Действительно до',
        'manager.name': 'Имя менеджера', 'manager.role': 'Должность менеджера', 'manager.phone': 'Телефон менеджера',
        'client.name': 'Имя клиента', 'client.contact': 'Контакт клиента', clientId: 'Клиент CRM',
        'fx.rate': 'Курс КП', 'fx.date': 'Дата курса', 'fx.currency': 'Валюта курса', fx: 'Курс КП',
        items: 'Позиции и материалы', delivery: 'Доставка, выгрузка и монтаж', discount: 'Скидка', discountMode: 'Режим скидки',
        currency: 'Валюта', intro: 'Вводный текст', totalNote: 'Пояснение к итогу', payment: 'Условия оплаты', warrantyMonths: 'Гарантия', footer: 'Подвал и реквизиты' };
    var item = /^items\.(\d+)\.(.+)$/.exec(path);
    if (item) return 'Позиция ' + (Number(item[1]) + 1) + ': ' + ({ name: 'название', price: 'цена', qty: 'количество', description: 'описание', size: 'размеры', note: 'примечание', products: 'материалы' }[item[2]] || 'данные изделия');
    return labels[path] || 'Дополнительные данные КП';
}
function reviewValue(bundle, path) { return path.split('.').reduce(function (value, key) { return value == null ? undefined : value[key]; }, bundle); }
function reviewSummary(value) {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) return value.length + ' поз.: ' + value.slice(0, 5).map(function (item) { return item.name || item.title || 'без названия'; }).join(', ');
    return (typeof value === 'object' ? JSON.stringify(value) : String(value)).slice(0, 500);
}
function reviewText(paths, base, local, remote) {
    return paths.slice(0, 12).map(function (path) { return reviewLabel(path) + '\nОснова: ' + reviewSummary(reviewValue(base, path)) +
        '\nМои изменения: ' + reviewSummary(reviewValue(local, path)) + '\nНа сервере: ' + reviewSummary(reviewValue(remote, path)); }).join('\n\n');
}
function draftDifference(local, remote) {
    var paths = [];
    function visit(left, right, path) {
        if (JSON.stringify(left) === JSON.stringify(right) || paths.length >= 12) return;
        if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right))
            Array.from(new Set(Object.keys(left).concat(Object.keys(right)))).forEach(function (key) { visit(left[key], right[key], path + '.' + key); });
        else paths.push(path);
    }
    visit(local, remote, 'state'); return paths.length ? paths : ['state'];
}
function restoreDraftValue(base, local, remote) {
    if (JSON.stringify(local) === JSON.stringify(base)) return remote;
    if (local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)) {
        var result = {};
        Array.from(new Set(Object.keys(base || {}).concat(Object.keys(local), Object.keys(remote)))).forEach(function (key) {
            var value = restoreDraftValue(base?.[key], local[key], remote[key]); if (value !== undefined) result[key] = value;
        });
        return result;
    }
    return local;
}
function reviewDraft() {
    if (!pendingDraftReview) return Promise.resolve(null);
    if (draftReviewPromise) return draftReviewPromise;
    var candidate = pendingDraftReview, reviewId = candidate.remote.id;
    draftReviewPromise = (async function () {
        var local = { state: candidate.draft.state, fx: candidate.draft.local?.fx, clientId: candidate.draft.local?.client?.label },
            remote = { state: candidate.remote.state, fx: candidate.remote.fx, clientId: candidate.remote.client?.label },
            base = { state: candidate.draft.base?.state, fx: candidate.draft.base?.fx, clientId: candidate.draft.base?.client?.label };
        var paths = draftDifference(local.state, remote.state);
        if (candidate.draft.local && JSON.stringify(local.fx) !== JSON.stringify(remote.fx)) paths.unshift('fx');
        if (candidate.draft.local && candidate.draft.local.client?.id !== candidate.remote.client?.id) paths.unshift('clientId');
        var text = 'Черновик редакции ' + candidate.draft.revision + '; на сервере редакция ' + candidate.remote.revision + '. Сохранённые копии не удаляются.\n\n' +
            reviewText(paths, base, local, remote);
        if (candidate.draft.legacy) text += '\n\nВ старом формате нет основы для объединения: будет восстановлен весь снимок полей черновика. Добавленные на сервере поля могут быть заменены при последующем сохранении. Курс и клиент автоматически не заменяются.';
        else text += '\n\nСерверные изменения других полей сохранятся. В совпавших полях будут выбраны значения черновика.';
        text += '\nПосле восстановления проверьте поля и отдельно сохраните КП. Все исходные копии остаются в браузере.';
        var choice = await showReview('Найден черновик другой редакции', text, 'Восстановить черновик');
        if (!choice) return null;
        if (currentDocId !== reviewId || pendingDraftReview !== candidate) throw new Error('Открыто другое КП. Черновик не применён');
        preserveDraft('draft-review', candidate);
        var latest = await CRM.request('/api/documents?id=' + encodeURIComponent(reviewId));
        if (currentDocId !== reviewId || pendingDraftReview !== candidate) throw new Error('Открыто другое КП. Черновик не применён');
        if (choice === 'local' && (latest.revision !== candidate.remote.revision || JSON.stringify(latest.state) !== JSON.stringify(candidate.remote.state))) {
            candidate.remote = clone(latest); throw new Error('КП на сервере изменилось. Проверьте черновик ещё раз');
        }
        applyDocumentState(latest, false);
        if (choice === 'local') {
            var restored = candidate.draft.local ? clone(candidate.draft.local) : null;
            if (restored && candidate.draft.base) {
                restored.state = restoreDraftValue(candidate.draft.base.state, restored.state, latest.state);
                restored.fx = restoreDraftValue(candidate.draft.base.fx, restored.fx, latest.fx);
                if (restored.client?.id === candidate.draft.base.client?.id) restored.client = latest.client;
            }
            applyLocalDraft(restored ? restored.state : candidate.draft.state);
            if (restored && typeof CRM.restoreDraftContext === 'function') CRM.restoreDraftContext(restored);
            syncStaticInputs(); refreshAll();
        }
        pendingDraftReview = null; saveNow(); return choice;
    })().finally(function () { draftReviewPromise = null; });
    return draftReviewPromise;
}
async function reviewSaveConflict() {
    var conflict = typeof CRM.getSaveConflict === 'function' ? CRM.getSaveConflict() : null;
    if (!conflict) return null;
    preserveDraft('save-conflict-review', conflict);
    var choice = await showReview('КП изменилось на сервере', 'Совпали изменения в следующих полях. Выберите, какие значения оставить. Отмена сохраняет мой черновик.\n\n' +
        reviewText(conflict.paths, conflict.base, conflict.local, conflict.remote), 'Сохранить мои изменения');
    if (!choice) { lastSaveError = new Error('Сохранение отменено. Мой черновик сохранён'); return null; }
    if (currentDocId !== conflict.proposalId) throw new Error('Открыто другое КП. Изменения не применены');
    var doc = await CRM.resolveSaveConflict(choice); applyDocumentState(doc, false); saveNow(); return doc;
}

docsList.addEventListener('click', function (e) {
    var op = e.target.closest('.doc-open');
    if (op) {
        var row = op.closest('.doc-row');
        applySavedDoc(row.dataset.docid);
        setDocsPanel(false);
        return;
    }
    var del = e.target.closest('.doc-del');
    if (del) {
        var drow = del.closest('.doc-row');
        toggleDocsConfirm(true, drow.dataset.docid, drow.querySelector('.doc-open').textContent);
    }
});

confirmCancel.addEventListener('click', function () { if (reviewDecision) finishReview(null); else toggleDocsConfirm(false, '', ''); });
confirmOk.addEventListener('click', function () { if (reviewDecision) finishReview('local'); });

confirmModal.addEventListener('click', function (e) {
    if (e.target === confirmModal) { if (reviewDecision) finishReview(null); else toggleDocsConfirm(false, '', ''); }
});
document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && reviewDecision) finishReview(null); });

confirmCancel.addEventListener('click', function () {
    if (!reviewDecision) { toggleDocsConfirm(false, '', ''); confirmOk.style.display = ''; }
});

function applyDocumentState(doc, preview) {
    clearTimeout(remoteSaveT);
    if (pendingDraftReview && (preview || pendingDraftReview.remote.id !== doc.id)) { finishReview(null); pendingDraftReview = null; }
    cancelMediaUploads();
    if (!preview) CRM.focusDocument(doc);
    state = deepMerge(clone(DEFAULT), doc.state);
    state.warrantyMonths = doc.state.warrantyMonths == null ? null : doc.state.warrantyMonths;
    state.items.forEach(normItem);
    if (!state.delivery) state.delivery = clone(DEFAULT.delivery);
    if (state.delivery.visible === undefined) state.delivery.visible = true;
    if (state.discountMode !== 'amount') state.discountMode = 'percent';
    currentDocId = doc.id;
    docsNamesCache[doc.id] = docNumber(doc); saveDocsNamesCache();
    syncStaticInputs(); refreshAll(); renderDocsCurrent(); renderDocsSaveBtn(); CRM.applyPermissions();
    if (!preview) CRM.acknowledgeHydration(doc, state);
}
async function applySavedDoc(id, skipSaveCurrent) {
    if (!skipSaveCurrent && currentDocId && currentDocId !== id && CRM.isEditable()) {
        var saved = await saveCurrentDoc(currentDocId);
        if (!saved) return false;
    }
    docsBusy(true, 'Открываем КП…');
    try {
        var doc = await CRM.request('/api/documents?id=' + encodeURIComponent(id));
        applyDocumentState(doc, false);
        return true;
    } catch (error) { CRM.reportError(error); toast(error.message || 'Не удалось открыть КП', 5000); return false; }
    finally { docsBusy(false); }
}

function alertModal(title, text) {
    confirmTitle.textContent = title;
    confirmText.textContent = text || '';
    confirmOk.style.display = 'none';
    confirmModal.hidden = false;
}

var lastSaveError = null;
async function saveCurrentDoc(id, opts) {
    lastSaveError = null;
    opts = opts || {};
    clearTimeout(remoteSaveT);
    if (!CRM.isEditable()) return CRM.getDocument();
    try {
        await awaitMediaUploads(currentDocId);
        if (pendingDraftReview) {
            saveNow(); if (opts.silent) return null;
            var draftChoice = await reviewDraft();
            if (draftChoice === 'remote') return CRM.getDocument();
            lastSaveError = new Error(draftChoice ? 'Черновик восстановлен. Проверьте поля и сохраните КП' : 'Восстановление отменено. Черновик сохранён');
            if (draftChoice) toast(lastSaveError.message, 5000); return null;
        }
        if (!CRM.isEditable()) throw new Error('КП доступно только для просмотра');
        saveNow();
        if (typeof CRM.getSaveConflict === 'function' && CRM.getSaveConflict()) return opts.silent ? null : await reviewSaveConflict();
        var snapshot = clone(state), serialized = JSON.stringify(snapshot);
        var doc = await CRM.save(snapshot);
        currentDocId = doc.id;
        if (JSON.stringify(state) === serialized) state = clone(doc.state);
        if (doc.state.order) state.order.number = doc.state.order.number;
        docsNamesCache[doc.id] = docNumber(doc); saveDocsNamesCache();
        renderDocsCurrent(); renderDocsSaveBtn(); syncStaticInputs(); renderSheet(); updateTotal(); saveNow();
        return doc;
    } catch (error) {
        lastSaveError = error; saveNow();
        if (!opts.silent && typeof CRM.getSaveConflict === 'function' && CRM.getSaveConflict()) {
            try { return await reviewSaveConflict(); } catch (reviewError) { lastSaveError = reviewError; }
        }
        if (!opts.silent) toast(lastSaveError.message || 'Не удалось сохранить КП', 5000); return null;
    }
}

async function ensureCurrentSaved() {
    if (CRM.isPaused()) throw new Error('Завершите изменение клиента');
    await awaitMediaUploads(currentDocId);
    if (!CRM.isEditable() || !pendingDraftReview && !(typeof CRM.getSaveConflict === 'function' && CRM.getSaveConflict()) && !CRM.hasUnsavedChanges(state)) return CRM.getDocument();
    var saved = await saveCurrentDoc(currentDocId || undefined);
    if (!saved) throw lastSaveError || new Error('Не удалось сохранить КП');
    return saved;
}

docsSaveBtn.addEventListener('click', async function () {
    docsBusy(true, 'Сохраняем КП…');
    var doc = await saveCurrentDoc(currentDocId || undefined);
    docsBusy(false);
    if (doc) {
        setDocsPanel(false);
        toast('КП сохранено: ' + (doc.name || 'документ'));
        loadDocsList(true);
    }
});

document.querySelectorAll('.js-new').forEach(function (button) {
    button.addEventListener('click', async function () {
        if (!confirm('Создать новое КП и проект «Лид»?')) return;
        if (CRM.isEditable() && !await saveCurrentDoc(currentDocId)) return;
        docsBusy(true, 'Создаём КП…');
        try { var doc = await CRM.create(); applyDocumentState(doc, false); toast('Новое КП создано'); }
        catch (error) { toast(error.message, 5000); }
        finally { docsBusy(false); }
    });
});

var zoom = 1, userZoomed = false;
function applyZoom() { scaleEl.style.transform = 'scale(' + zoom + ')'; if (zval) zval.textContent = Math.round(zoom * 100) + '%'; }
function fit() {
    var avail = viewport.clientWidth - 16;
    zoom = Math.max(0.35, Math.min(1.0, avail / 794));
    userZoomed = false; applyZoom();
}
document.querySelectorAll('.js-zin').forEach(function (b) { b.addEventListener('click', function () { zoom = Math.min(2, +(zoom + 0.05).toFixed(2)); userZoomed = true; applyZoom(); }); });
document.querySelectorAll('.js-zout').forEach(function (b) { b.addEventListener('click', function () { zoom = Math.max(0.3, +(zoom - 0.05).toFixed(2)); userZoomed = true; applyZoom(); }); });
var rT; window.addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(function () { if (!userZoomed) fit(); }, 120); });

var viewTabs = document.getElementById('viewTabs');
if (viewTabs) {
    viewTabs.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-view]');
        if (!tab) return;
        var sheetView = tab.dataset.view === 'sheet';
        document.body.classList.toggle('view-sheet', sheetView);
        viewTabs.querySelectorAll('.view-tab').forEach(function (t) { t.classList.toggle('on', t === tab); });
        if (sheetView) {
            window.scrollTo(0, 0);
            if (!userZoomed) requestAnimationFrame(fit);
        }
    });
}

var wraps = Array.prototype.slice.call(document.querySelectorAll('.sf-wrap'));
var px = 0, py = 0, pRaf = null;
window.addEventListener('pointermove', function (e) {
    px = (e.clientX / window.innerWidth - 0.5); py = (e.clientY / window.innerHeight - 0.5);
    if (!pRaf) {
        pRaf = requestAnimationFrame(function () {
            wraps.forEach(function (w) {
                var d = +w.dataset.depth || 14;
                w.style.transform = 'translate3d(' + (px * d).toFixed(1) + 'px,' + (py * d).toFixed(1) + 'px,0)';
            });
            pRaf = null;
        });
    }
});

var toastT;
function toast(msg, ms) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2600);
}

CRM.attachEditor({
    getState: function () { return clone(state); },
    applyDocument: applyDocumentState,
    applyState: function (next) { state = clone(next); syncStaticInputs(); refreshAll(); },
    ensureSaved: ensureCurrentSaved,
    generatePdf: function () { return genPdf(true); },
    openContract: function () { return window.ContractEditor.open(); },
    notify: toast
});
(async function () {
    docsBusy(true, 'Открываем КП…');
    var opened = await applySavedDoc(CRM.getDocumentId(), true);
    if (opened && CRM.isEditable() && loadSaved()) { syncStaticInputs(); refreshAll(); toast('Черновик восстановлен из автосохранения'); }
    requestAnimationFrame(fit);
    CRM.applyPermissions();
})();
window.addEventListener('load', function () { if (!userZoomed) fit(); updatePageCount(); });
window.addEventListener('pagehide', saveNow);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(updatePageCount);

if (window.ContractEditor) {
    window.ContractEditor.init({
        getState: function () { return clone(state); },
        getDocumentId: function () { return currentDocId; },
        ensureSaved: ensureCurrentSaved,
        onOpenChange: CRM.setContractOpen,
        notify: toast
    });
}
        })();
