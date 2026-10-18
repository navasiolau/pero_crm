(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./sheet-render'));
    else root.ContractModel = factory(root.SheetRender);
}(typeof self !== 'undefined' ? self : this, function (Sheet) {
    'use strict';

    var TERM_KEYS = ['productionDays', 'productionUnit', 'installationDays', 'installationUnit', 'warrantyMonths'];
    var CUSTOMER_KEYS = ['type', 'name', 'signature', 'phone', 'email', 'registrationAddress', 'passport', 'taxId', 'registrationId', 'bankDetails', 'representative', 'position', 'authority'];
    var CURRENCIES = {
        RUB: { symbol: '₽', major: ['рубль', 'рубля', 'рублей'], minor: ['копейка', 'копейки', 'копеек'] },
        BYN: { symbol: 'BYN', major: ['белорусский рубль', 'белорусских рубля', 'белорусских рублей'], minor: ['копейка', 'копейки', 'копеек'] },
        USD: { symbol: '$', major: ['доллар США', 'доллара США', 'долларов США'], minor: ['цент', 'цента', 'центов'] },
        EUR: { symbol: '€', major: ['евро', 'евро', 'евро'], minor: ['цент', 'цента', 'центов'] }
    };

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function text(value, limit) { return String(value == null ? '' : value).trim().slice(0, limit || 2000); }
    function number(value) {
        if (value === '' || value == null) return NaN;
        return Number(String(value).replace(',', '.'));
    }
    function minor(value) { return Math.round((number(value) + Number.EPSILON) * 100); }
    function currency(value) {
        return ({ '₽': 'RUB', '$': 'USD', '€': 'EUR' })[value] || (CURRENCIES[value] ? value : null);
    }
    function plural(value, forms) {
        var n = Math.abs(value) % 100, last = n % 10;
        return forms[n > 10 && n < 20 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2];
    }
    function isoDate(value) {
        var match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text(value));
        return match ? match[3] + '-' + match[2] + '-' + match[1] : text(value);
    }
    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        var d = new Date(value + 'T12:00:00Z');
        return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
    }
    function today(now) {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
    }
    function subjectFor(proposals) {
        var projects = [];
        proposals.forEach(function (proposal) {
            var project = text(proposal.state && proposal.state.order && proposal.state.order.project);
            if (project && projects.indexOf(project) < 0) projects.push(project);
        });
        return projects.length ? 'Изготовление, сборка и монтаж: ' + projects.join('; ') : 'Изготовление, сборка и монтаж мебели по индивидуальному заказу';
    }
    function defaults(state, documentId, now) {
        state = state || {};
        var client = state.client || {}, order = state.order || {};
        return {
            number: text(order.number, 100), date: today(now), city: 'Москва', contractorProfileId: 'pero-by',
            subject: subjectFor([{ state: state }]),
            deliveryAddress: '',
            customer: { type: 'individual', name: text(client.name), signature: '', phone: /^\+?[\d\s().-]+$/.test(client.contact || '') ? text(client.contact) : '', email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.contact || '') ? text(client.contact) : '', registrationAddress: '', passport: '', taxId: '', registrationId: '', bankDetails: '', representative: '', position: '', authority: '' },
            proposalIds: documentId ? [documentId] : [], proposalOverrides: {}, sameCustomerConfirmed: false,
            productionDays: 55, productionUnit: 'working', installationDays: 20, installationUnit: 'calendar', warrantyMonths: 12,
            payments: splitPayments(2)
        };
    }
    function splitPayments(count) {
        count = Math.max(1, Math.min(10, Math.round(number(count)) || 2));
        if (count === 2) return [{ mode: 'percent', value: 70, condition: 'Аванс при подписании договора' }, { mode: 'percent', value: 30, condition: 'После монтажа и подписания акта' }];
        var basis = Math.floor(10000 / count), payments = [];
        for (var i = 0; i < count; i++) payments.push({ mode: 'percent', value: (i === count - 1 ? 10000 - basis * (count - 1) : basis) / 100, condition: i === 0 ? 'При подписании договора' : i === count - 1 ? 'После монтажа и подписания акта' : 'После изготовления, перед доставкой' });
        return payments;
    }
    function normalizeSettings(value, state, documentId) {
        var out = defaults(state, documentId), input = value || {};
        ['number', 'city', 'subject', 'deliveryAddress'].forEach(function (key) { if (input[key] != null) out[key] = text(input[key]); });
        if (input.date != null) out.date = isoDate(input.date);
        if (input.contractorProfileId != null) out.contractorProfileId = text(input.contractorProfileId, 100);
        CUSTOMER_KEYS.forEach(function (key) { if (input.customer && input.customer[key] != null) out.customer[key] = text(input.customer[key]); });
        TERM_KEYS.forEach(function (key) { if (input[key] != null) out[key] = /Unit$/.test(key) ? text(input[key], 30) : input[key] === '' ? '' : number(input[key]); });
        if (Array.isArray(input.proposalIds)) out.proposalIds = input.proposalIds.map(function (id) { return text(id, 100); });
        if (input.proposalOverrides && typeof input.proposalOverrides === 'object') {
            out.proposalIds.forEach(function (id) {
                var value = input.proposalOverrides[id];
                if (!value || typeof value !== 'object') return;
                out.proposalOverrides[id] = {};
                TERM_KEYS.forEach(function (key) { if (value[key] != null) out.proposalOverrides[id][key] = /Unit$/.test(key) ? text(value[key], 30) : value[key] === '' ? '' : number(value[key]); });
            });
        }
        out.sameCustomerConfirmed = input.sameCustomerConfirmed === true;
        if (Array.isArray(input.payments)) out.payments = input.payments.map(function (p) { return { mode: p && p.mode === 'amount' ? 'amount' : 'percent', value: p && p.value === '' ? '' : number(p && p.value), condition: text(p && p.condition) }; });
        return out;
    }
    function termsFor(settings, id) {
        var out = {}, override = settings.proposalOverrides[id] || {};
        TERM_KEYS.forEach(function (key) { out[key] = override[key] != null ? override[key] : settings[key]; });
        return out;
    }
    function summarize(settings, proposals) {
        var errors = [], totalMinor = 0, commonCurrency = null, ids = {}, names = [], sources = [];
        function error(field, message) { errors.push({ field: field, message: message }); }
        if (!settings.proposalIds.length) error('proposalIds', 'Добавьте хотя бы одно КП');
        settings.proposalIds.forEach(function (id, index) {
            if (ids[id]) error('proposalIds', 'Одно и то же КП нельзя включить дважды');
            ids[id] = true;
            var proposal = proposals.filter(function (p) { return p.id === id; })[0];
            if (!proposal) { error('proposalIds', 'КП не загружено или удалено'); return; }
            var state = Sheet.normalizeState(proposal.state), code = state && currency(state.currency || '$');
            if (!state) { error('proposalIds', 'Некорректные данные КП'); return; }
            if (!code) error('currency', 'Валюта КП не поддерживается');
            if (commonCurrency && code !== commonCurrency) error('currency', 'Все КП договора должны быть в одной валюте');
            commonCurrency = commonCurrency || code;
            var value = minor(Sheet.totalsOf(state).total);
            if (!Number.isSafeInteger(value) || value < 0) error('total', 'Некорректная стоимость КП');
            else totalMinor += value;
            var client = text(state.client && state.client.name).toLowerCase().replace(/\s+/g, ' ');
            if (client && names.indexOf(client) < 0) names.push(client);
            sources.push({ id: id, number: text(state.order && state.order.number), date: text(state.order && state.order.date), client: text(state.client && state.client.name), updatedAt: proposal.updatedAt || 0, totalMinor: value, appendix: index + 1, terms: termsFor(settings, id) });
        });
        if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) error('total', 'Общая стоимость должна быть больше нуля');
        if (names.length > 1 && !settings.sameCustomerConfirmed) error('sameCustomerConfirmed', 'Подтвердите, что выбранные КП относятся к одному заказчику');
        var payments = [], sum = 0, percentSum = 0, allPercent = true;
        if (!settings.payments.length || settings.payments.length > 10) error('payments', 'График должен содержать от 1 до 10 платежей');
        settings.payments.forEach(function (p, index) {
            var value = number(p.value), amount = p.mode === 'amount' ? minor(value) : Math.round(totalMinor * value / 100);
            if (!Number.isFinite(value) || value <= 0 || p.mode === 'percent' && value > 100 || !Number.isSafeInteger(amount)) error('payments.' + index + '.value', 'Укажите положительную сумму или процент платежа');
            if (!text(p.condition)) error('payments.' + index + '.condition', 'Укажите условие оплаты');
            if (p.mode === 'amount') allPercent = false;
            else percentSum += value;
            payments.push({ mode: p.mode, value: value, condition: text(p.condition), amountMinor: amount, percent: totalMinor > 0 ? amount / totalMinor * 100 : 0 });
            sum += amount;
        });
        if (allPercent && payments.length && Math.abs(percentSum - 100) < 0.0000001) {
            payments[payments.length - 1].amountMinor += totalMinor - sum;
            sum = totalMinor;
        }
        if (sum !== totalMinor || allPercent && Math.abs(percentSum - 100) > 0.0000001) error('payments', 'Сумма платежей должна совпадать со стоимостью договора');
        if (payments.some(function (p) { return p.amountMinor <= 0; })) error('payments', 'Каждый платёж должен быть больше нуля');
        return { totalMinor: totalMinor, currency: commonCurrency, symbol: commonCurrency ? CURRENCIES[commonCurrency].symbol : '', sources: sources, payments: payments, balanceMinor: totalMinor - sum, customerMismatch: names.length > 1, projectAppendix: sources.length + 1, actAppendix: sources.length + 2, errors: errors };
    }
    function validate(settings, proposals, profiles) {
        var summary = summarize(settings, proposals), errors = summary.errors.slice();
        function required(field, value, message) { if (!text(value)) errors.push({ field: field, message: message }); }
        required('number', settings.number, 'Укажите номер договора');
        required('city', settings.city, 'Укажите город заключения договора');
        required('subject', settings.subject, 'Укажите предмет договора');
        required('deliveryAddress', settings.deliveryAddress, 'Укажите адрес объекта');
        required('customer.name', settings.customer.name, 'Укажите полное имя или наименование заказчика');
        if (!validDate(settings.date)) errors.push({ field: 'date', message: 'Укажите корректную дату договора' });
        if (['individual', 'soleProprietor', 'organization'].indexOf(settings.customer.type) < 0) errors.push({ field: 'customer.type', message: 'Выберите тип заказчика' });
        if (settings.customer.type !== 'individual') {
            required('customer.taxId', settings.customer.taxId, 'Укажите ИНН или УНП заказчика');
            required('customer.registrationAddress', settings.customer.registrationAddress, 'Укажите юридический адрес заказчика');
        }
        if (settings.customer.type === 'organization') {
            required('customer.representative', settings.customer.representative, 'Укажите подписанта заказчика');
            required('customer.authority', settings.customer.authority, 'Укажите основание полномочий подписанта');
        }
        if (profiles && !profiles.some(function (p) { return p.id === settings.contractorProfileId; })) errors.push({ field: 'contractorProfileId', message: 'Выберите исполнителя' });
        [{ terms: settings, prefix: '' }].concat(summary.sources.filter(function (s) { return settings.proposalOverrides[s.id]; }).map(function (s) { return { terms: s.terms, prefix: 'proposalOverrides.' + s.id + '.' }; })).forEach(function (entry) {
            var terms = entry.terms;
            ['productionDays', 'installationDays', 'warrantyMonths'].forEach(function (key) {
                if (!Number.isInteger(number(terms[key])) || number(terms[key]) <= 0 || number(terms[key]) > 3650) errors.push({ field: entry.prefix + key, message: 'Сроки и гарантия должны быть положительными целыми числами' });
            });
            ['productionUnit', 'installationUnit'].forEach(function (key) { if (['working', 'calendar'].indexOf(terms[key]) < 0) errors.push({ field: entry.prefix + key, message: 'Выберите рабочие или календарные дни' }); });
        });
        return { summary: summary, errors: errors };
    }
    function integerWords(value, feminine) {
        if (value === 0) return 'ноль';
        var ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
        var teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
        var tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
        var hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
        var groups = [null, ['тысяча', 'тысячи', 'тысяч'], ['миллион', 'миллиона', 'миллионов'], ['миллиард', 'миллиарда', 'миллиардов'], ['триллион', 'триллиона', 'триллионов']];
        var result = [], group = 0;
        while (value > 0) {
            var part = value % 1000, words = [], gender = group === 1 || group === 0 && feminine;
            if (part) {
                if (part >= 100) words.push(hundreds[Math.floor(part / 100)]);
                var rest = part % 100;
                if (rest >= 10 && rest < 20) words.push(teens[rest - 10]);
                else {
                    if (rest >= 20) words.push(tens[Math.floor(rest / 10)]);
                    var last = rest % 10;
                    if (last) words.push(gender && last === 1 ? 'одна' : gender && last === 2 ? 'две' : ones[last]);
                }
                if (group) words.push(plural(part, groups[group]));
                result.unshift(words.join(' '));
            }
            value = Math.floor(value / 1000); group++;
        }
        return result.join(' ');
    }
    function moneyWords(value, code) {
        var cur = CURRENCIES[code];
        if (!cur || !Number.isSafeInteger(value) || value < 0) throw new Error('Некорректная сумма');
        var whole = Math.floor(value / 100), fraction = value % 100;
        return integerWords(whole) + ' ' + plural(whole, cur.major) + ' ' + String(fraction).padStart(2, '0') + ' ' + plural(fraction, cur.minor);
    }
    function money(value, code) {
        return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100) + ' ' + (CURRENCIES[code] ? CURRENCIES[code].symbol : '');
    }

    return { defaults: defaults, normalizeSettings: normalizeSettings, splitPayments: splitPayments, summarize: summarize, validate: validate, termsFor: termsFor, subjectFor: subjectFor, currency: currency, minor: minor, money: money, moneyWords: moneyWords, integerWords: integerWords, plural: plural, isoDate: isoDate, validDate: validDate, clone: clone, currencies: CURRENCIES, termKeys: TERM_KEYS };
}));
