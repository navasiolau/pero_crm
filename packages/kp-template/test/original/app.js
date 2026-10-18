(function () {
'use strict';
var LS_KEY = 'pero-live-kp-state-v3';
var DOCS_LS_KEY = 'pero-live-kp-docs-v1';

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

var state = clone(DEFAULT);

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function setPath(o, path, val) { var p = path.split('.'), cur = o; for (var i = 0; i < p.length - 1; i++) { cur = cur[p[i]]; } cur[p[p.length - 1]] = val; }
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
document.getElementById('brandLogo').innerHTML = LOGO;

var generating = false;
function setPdfBtns(label, disabled) {
    document.querySelectorAll('.js-pdf').forEach(function (b) { b.textContent = label; b.disabled = !!disabled; });
}
async function genPdf() {
    if (generating) return;
    generating = true;
    setPdfBtns('Готовим PDF…', true);
    try {
        var r = await fetch('/api/kp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
        if (r.status === 401) { location.reload(); return; }
        if (!r.ok) { var err = await r.json().catch(function () { return {}; }); throw new Error(err.error || 'HTTP ' + r.status); }
        var blob = await r.blob();
        var url = URL.createObjectURL(blob);
        var fileName = pdfFileName(state);
        if (/iP(hone|ad|od)/.test(navigator.userAgent)) {
            window.open(url, '_blank');
        } else {
            var a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { document.body.removeChild(a); }, 300);
        }
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        toast('PDF сформирован и скачан');
    } catch (err) {
        console.error('[PDF]', err);
        toast('Не удалось сформировать PDF: ' + (err.message || err), 5000);
    }
    generating = false;
    setPdfBtns('Сгенерировать PDF', false);
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
    var thumb = it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<div class="item-thumb-ph">Фото</div>';
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
        '<input class="url-input" data-path="items.' + i + '.image" placeholder="или вставьте URL изображения" value="' + esc(it.image || '') + '">' +
        '</div>' +
        (it.dbl ?
            '<div class="photo-row photo-row-2">' +
            '<label class="file-btn">Загрузить<input type="file" accept="image/*" data-file-idx2="' + i + '"></label>' +
            '<input class="url-input" data-path="items.' + i + '.image2" placeholder="или вставьте URL изображения" value="' + esc(it.image2 || '') + '">' +
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
    sheet.innerHTML = sheetHTML(state);
    document.title = 'КП ' + (state.order.number || '—') + ' · Перо Лайв';
    requestAnimationFrame(updatePageCount);
}

function updatePageCount() {
    var pages = sheet.querySelectorAll('.page').length;
    pagesChip.textContent = pages + ' ' + plural(pages, 'страница', 'страницы', 'страниц') + ' A4';
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
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveNow, 500); }
function saveNow() {
    try {
        var snapshot = clone(state);
        snapshot.__docId = currentDocId;
        localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
    } catch (e) { }
}
function loadSaved() {
    try {
        var raw = localStorage.getItem(LS_KEY);
        if (!raw) return false;
        var data = JSON.parse(raw);
        if (!data || !Array.isArray(data.items)) return false;
        if (typeof data.__docId === 'string') currentDocId = data.__docId;
        delete data.__docId;
        state = deepMerge(clone(DEFAULT), data);
        state.warrantyMonths = data.warrantyMonths == null ? null : data.warrantyMonths;
        state.items.forEach(normItem);
        state.items.forEach(function (it) {
            ['image', 'image2'].forEach(function (k) {
                if (typeof it[k] === 'string' && it[k].indexOf('data:') === 0) it[k] = '';
            });
        });
        if (!state.delivery) state.delivery = clone(DEFAULT.delivery);
        if (state.delivery.visible === undefined) state.delivery.visible = true;
        if (state.discountMode !== 'amount') state.discountMode = 'percent';
        if (state.doubleMode) { state.items.forEach(function (it) { it.dbl = true; }); }
        return true;
    } catch (e) { return false; }
}

function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
            var w = img.width, h = img.height;
            var k = Math.min(1, maxSide / Math.max(w, h));
            w = Math.round(w * k); h = Math.round(h * k);
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            c.toBlob(function (b) {
                if (b) resolve(new File([b], (file.name.replace(/\.\w+$/, '') || 'photo') + '.jpg', { type: 'image/jpeg' }));
                else reject(new Error('Не удалось сжать изображение'));
            }, 'image/jpeg', quality);
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать файл')); };
        img.src = url;
    });
}

async function uploadToR2(file) {
    var compressed = await compressImage(file, 1600, 0.82);
    var r = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: compressed.type, size: compressed.size })
    });
    if (r.status === 401) { location.reload(); return ''; }
    if (!r.ok) {
        var msg = '';
        try { msg = (await r.json()).error || ''; } catch (e) { }
        throw new Error(msg || ('HTTP ' + r.status));
    }
    var data = await r.json();
    var put = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': compressed.type },
        body: compressed
    });
    if (!put.ok) {
        fetch('/api/uploads', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: data.key })
        }).catch(function () { });
        throw new Error('PUT в хранилище: HTTP ' + put.status);
    }
    return data.publicUrl;
}

function handlePhotoInput(input, i, slot) {
    var f = input.files && input.files[0];
    if (!f) return;
    var card = input.closest('.item-card');
    var urlInputs = card.querySelectorAll('.url-input');
    var urlInput = slot === 'image2' ? urlInputs[urlInputs.length - 1] : urlInputs[0];

    var previewUrl = URL.createObjectURL(f);
    if (slot === 'image') refreshThumb(card, previewUrl);
    toast('Загружаем фото в хранилище…');
    uploadToR2(f).then(function (publicUrl) {
        URL.revokeObjectURL(previewUrl);
        state.items[i][slot] = publicUrl;
        if (slot === 'image') refreshThumb(card, publicUrl);
        if (urlInput) urlInput.value = publicUrl;
        renderSheet(); scheduleSave();
        toast('Фото загружено ✓');
    }).catch(function (err) {
        console.error('[R2 upload]', err);
        URL.revokeObjectURL(previewUrl);
        if (slot === 'image') refreshThumb(card, state.items[i][slot]);
        toast('Не удалось загрузить фото в R2 (' + (err.message || 'ошибка') + ') — позиция осталась без этого фото', 6000);
    }).finally(function () {
        input.value = '';
    });
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
        var copy = clone(normItem(state.items[i])); copy.name += ' (копия)';
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
    var d = new Date(updatedAt);
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2) + ':' + pad2(d.getHours()) + '.' + pad2(d.getMinutes());
}

function docNumber(doc) {
    var number = '';
    if (doc.name) {
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
        var r = await fetch('/api/documents');
        if (r.status === 401) { location.reload(); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
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
                    '<button class="doc-del" type="button" title="Удалить КП">✕</button>' +
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

confirmCancel.addEventListener('click', function () { toggleDocsConfirm(false, '', ''); });

confirmModal.addEventListener('click', function (e) {
    if (e.target === confirmModal) { toggleDocsConfirm(false, '', ''); }
});

confirmCancel.addEventListener('click', function () {
    toggleDocsConfirm(false, '', '');
    confirmOk.style.display = '';
});

confirmOk.addEventListener('click', async function () {
    var id = confirmModal.dataset.docid;
    toggleDocsConfirm(false, '', '');
    docsBusy(true, 'Удаляем…');
    try {
        var r = await fetch('/api/documents?id=' + encodeURIComponent(id), { method: 'DELETE' });
        if (r.status === 401) { location.reload(); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (currentDocId === id) {
            currentDocId = null;
            renderDocsCurrent();
            saveNow();
        }
        if (docsNamesCache[id]) {
            delete docsNamesCache[id];
            saveDocsNamesCache();
        }
        toast('КП удалено');
        loadDocsList(true);
    } catch (err) {
        console.error('[docs delete]', err);
        toast('Не удалось удалить: ' + (err.message || err), 5000);
    }
    docsBusy(false);
});

async function applySavedDoc(id, skipSaveCurrent) {
    if (!skipSaveCurrent && currentDocId && currentDocId !== id) {
        docsBusy(true, 'Сохраняем текущее КП…');
        var saved = await saveCurrentDoc(currentDocId);
        if (!saved) { docsBusy(false); return false; }
    }
    docsBusy(true, 'Открываем КП…');
    var ok = false;
    try {
        var r = await fetch('/api/documents?id=' + encodeURIComponent(id));
        if (r.status === 401) { location.reload(); return false; }
        if (!r.ok) { var err = await r.json().catch(function () { return {}; }); throw new Error(err.error || 'HTTP ' + r.status); }
        var doc = await r.json();
        state = deepMerge(clone(DEFAULT), doc.state);
        state.warrantyMonths = doc.state.warrantyMonths == null ? null : doc.state.warrantyMonths;
        state.items.forEach(normItem);
        if (!state.delivery) state.delivery = clone(DEFAULT.delivery);
        if (state.delivery.visible === undefined) state.delivery.visible = true;
        if (state.discountMode !== 'amount') state.discountMode = 'percent';
        currentDocId = id;
        docsNamesCache[id] = docNumber(doc);
        saveDocsNamesCache();
        syncStaticInputs();
        refreshAll();
        scheduleSave();
        renderDocsCurrent();
        toast('КП открыто' + (doc.name ? ': ' + doc.name : ''));
        ok = true;
    } catch (err) {
        console.error('[docs open]', err);
        toast('Не удалось открыть: ' + (err.message || err), 5000);
    }
    docsBusy(false);
    return ok;
}

function alertModal(title, text) {
    confirmTitle.textContent = title;
    confirmText.textContent = text || '';
    confirmOk.style.display = 'none';
    confirmModal.hidden = false;
}

async function saveCurrentDoc(id, opts) {
    opts = opts || {};
    try {
        var r = await fetch('/api/documents', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id || undefined, state: state })
        });
        if (r.status === 401) { location.reload(); return null; }
        if (!r.ok) { var err = await r.json().catch(function () { return {}; }); throw new Error(err.error || 'HTTP ' + r.status); }
        var doc = await r.json();
        if (doc && doc.id) {
            currentDocId = doc.id;
            docsNamesCache[doc.id] = docNumber(doc);
            saveDocsNamesCache();
            renderDocsCurrent();
            renderDocsSaveBtn();
            scheduleSave();
        }
        return doc;
    } catch (e) {
        console.error('[docs save]', e);
        if (!opts.silent) toast('Не удалось сохранить: ' + (e.message || e), 5000);
        return null;
    }
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

document.querySelectorAll('.js-new').forEach(function (b) {
    b.addEventListener('click', function () {
        if (!confirm('Начать новое КП? Текущие поля будут очищены.')) return;
        state = clone(DEFAULT);
        state.order = { number: '', date: '', validUntil: '', project: '' };
        state.client = { name: '', contact: '' };
        state.discount = 0;
        state.intro = '';
        state.items = [];
        state.delivery = { mode: 'total', items: [], total: 0, visible: true };
        currentDocId = null;
        renderDocsCurrent();
        renderDocsSaveBtn();
        syncStaticInputs(); refreshAll(); scheduleSave();
        toast('Новое КП — заполняйте');
    });
});

var zoom = 1, userZoomed = false;
function applyZoom() { scaleEl.style.transform = 'scale(' + zoom + ')'; zval.textContent = Math.round(zoom * 100) + '%'; }
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

var restored = loadSaved();
syncStaticInputs();
renderItemsEditor();
renderDeliveryEditor();
renderDiscToggle();
renderSheet();
updateTotal();
renderDocsCurrent();
renderDocsSaveBtn();
requestAnimationFrame(fit);
window.addEventListener('load', function () { if (!userZoomed) fit(); updatePageCount(); });
if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { updatePageCount(); }); }
if (restored) { toast('Черновик восстановлен из автосохранения'); }

if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        var meta = document.querySelector('meta[name="deploy-id"]');
        var deployId = (meta && meta.content) || 'local';
        navigator.serviceWorker.register('/sw.js?v=' + encodeURIComponent(deployId)).catch(function (e) {
            console.warn('[SW] регистрация не удалась', e);
        });
    });
}
if (window.ContractEditor) {
    window.ContractEditor.init({
        getState: function () { return clone(state); },
        getDocumentId: function () { return currentDocId; },
        ensureSaved: function () { return saveCurrentDoc(currentDocId || undefined); },
        notify: toast
    });
}
        })();
