'use strict';

const FurnitureSpecifications = require('../public/js/furniture-specifications');

const REVISION = '1 от 22.11.2026';
const TITLE = 'Инструкция по эксплуатации мебели PERO';

const sources = {
    regulation: { title: 'ТР ТС 025/2012, ст. 5, пп. 6 и 7.4', url: 'https://eec.eaeunion.org/upload/medialibrary/f2f/RS_P_32.pdf#page=11' },
    egger: { title: 'EGGER, рекомендации по очистке и уходу, ред. 02 от 22.05.2026, стр. 1–3', url: 'https://downloads.egger.com/static/east/TL_EGGER_Cleaning_and_care_instructions_en.pdf' },
    dekta: { title: 'DEKTA, рекомендации по уходу за TSS-плитами, стр. 1–2', url: 'https://dekta.design/uploads/Zagruzki/Rekomendacii-po-uxodu-za-poverxnostyami-iz-TSS-plit-DEKTA.pdf' },
    smartquartz: { title: 'SmartQuartz, раздел «Как ухаживать за SmartQuartz®?»', url: 'https://smartquartz.ru/faq/' },
    belenco: { title: 'Belenco, Technical Guidelines, стр. 5 и 9', url: 'https://www.belenco.com/theme/webs03/file/technical-guidelines.pdf#page=9' },
    salice: { title: 'Salice, AIR Technical Catalogue, стр. 8', url: 'https://www.salice.com/media/Catalog/hinges/air/Salice_AIR_D0CASA014ENG.pdf#page=8' },
    blum: { title: 'BLUM, LEGRABOX Planning, стр. 16, корпусные направляющие', url: 'https://www.blum.com/file/cme172774_ep_dok_bau?country=eu&language=en#page=16' },
};

const rules = [
    'Пользуйтесь мебелью по назначению. Сохраняйте предусмотренные крепления и защиту от опрокидывания. Не вставайте на полки, ящики и столешницы.',
    'Распределяйте груз равномерно. Соблюдайте пределы нагрузки, указанные для соответствующего изделия или элемента в приложениях к договору. Не опирайтесь на открытые дверцы и выдвинутые ящики.',
    'Удаляйте пролитую воду сразу, особенно у мойки, кромок, вырезов и стыков. Не допускайте попадания жидкостей на детали, соприкасающиеся с полом. При протечке остановите подачу воды, если это безопасно.',
    'Под горячую посуду ставьте подставку. Защищайте мебель от перегрева и направленной струи пара. Возле нагревательных и отопительных приборов предохраняйте элементы мебели от нагрева выше +40 °C.',
    'Для повседневного ухода используйте мягкую ткань и средства для соответствующего покрытия. Не применяйте абразивы и агрессивные средства. Слегка влажную уборку выполняйте там, где её допускает изготовитель, и вытирайте поверхность насухо.',
    'Если использование может увеличить повреждение или создать опасность, прекратите пользоваться повреждённым элементом. Сообщите Исполнителю по контактам договора, где и когда обнаружен недостаток.',
];

function entry(title, text, source) {
    return { title, text, source };
}

function has(text, pattern) {
    return new RegExp('(?<![\\p{L}\\p{N}])(?:' + pattern + ')(?![\\p{L}\\p{N}])', 'u').test(text);
}

function materialRules(value) {
    const found = [];
    if (has(value, 'EGGER|ЭГГЕР') && has(value, 'ЛДСП|ЛМДФ|EURODEKOR|ЕВРОДЕКОР|PERFECTSENSE|ДЕКОРАТИВНЫЕ ПЛИТЫ')) {
        found.push(entry('Декоративные поверхности EGGER', 'Протирайте мягкой слегка влажной тканью и вытирайте насухо. Быстро удаляйте жидкость у вырезов и стыков. Средство выбирайте по виду покрытия с учётом указаний для PerfectSense.', sources.egger));
    }
    if (has(value, 'DEKTA|ДЕКТА|ДЭКТА') && has(value, 'TSS|ТСС')) {
        found.push(entry('Плиты DEKTA TSS', 'Протирайте хорошо отжатой мягкой тканью и сразу вытирайте насухо. Для бытовых загрязнений подходят нейтральные средства pH 6–8. Изготовитель рекомендует температуру воздуха от +5 °C и относительную влажность до 65 % для этих плит.', sources.dekta));
    }
    if (has(value, 'SMART\\s*QUARTZ|СМАРТ\\s*КВАРЦ')) {
        found.push(entry('Кварцевые поверхности SmartQuartz', 'Удаляйте свежие загрязнения водой или неабразивным средством для камня. Смойте остатки средства. Используйте разделочную доску и подставку под горячее, берегите кромки и углы от ударов.', sources.smartquartz));
    }
    if (has(value, 'BELENCO|БЕЛЕНКО') && /КВАРЦ|QUARTZ/u.test(value)) {
        found.push(entry('Кварцевые поверхности Belenco', 'Для ежедневной очистки используйте влажную мягкую ткань и нейтральное средство. Изготовитель рекомендует средства pH 5–8,5. Под горячую посуду ставьте термостойкую подставку.', sources.belenco));
    }
    return found;
}

const blumProfiles = new Map();
for (const [series, capacity, lengths] of [
    ['750', 40, [270, 300, 350, 400, 450, 500, 550, 600]],
    ['753', 70, [450, 500, 550, 600, 650]],
]) {
    for (const length of lengths) for (const suffix of ['S', 'T']) {
        blumProfiles.set(series + '.' + length + '1' + suffix, { capacity, length });
    }
}
const boyardCapacity = new Map([[270, '27,5'], [300, '30'], [350, '32,5'], [400, '35'], [450, '37,5'], [500, '40']]);
const boyardCatalog = 'https://www.boyard.biz/storage/docs/' + encodeURIComponent('Каталог-функциональной-фурнитуры-BOYARD-2024.pdf') + '/';
const boyardCodes = /(?<![\p{L}\p{N}])SB(08(?:W|GR)|28(?:W|GR|GRPH))\.1\/(270|300|350|400|450|500)(?![\p{L}\p{N}./-])/gu;
const unresolved = /(?<![\p{L}\p{N}])(?:ИЛИ|ЛИБО|АНАЛОГ\p{L}*|НА ВЫБОР|ПО СОГЛАСОВАНИЮ|УТОЧН\p{L}*|ВАРИАНТ\p{L}*|ЗАМЕН\p{L}*|ВОЗМОЖН\p{L}*|ВМЕСТО|БЕЗ|НЕ|ЕСЛИ)(?![\p{L}\p{N}])/u;

function loadRules(value) {
    if (unresolved.test(value) || value.replace(boyardCodes, '').includes('/')) return [];
    const found = [];
    if (has(value, 'SALICE\\s+AIR|AIR\\s*\\(\\s*SALICE\\s*\\)|САЛИЧЕ\\s+AIR|САЛИЧЕ\\s+ЭЙР')) {
        found.push(entry('Петли Salice AIR', 'Предельная масса двери — 25 кг при монтаже по схеме AIR сверху и снизу корпуса. Предел относится к деревянной двери толщиной от 18 мм или двери в алюминиевой рамке с габаритами до 2700 × 600 мм (высота × ширина).', sources.salice));
    }
    for (const match of value.matchAll(/(?<![\p{L}\p{N}])75[03]\.\d{4}[ST](?![\p{L}\p{N}./-])/gu)) {
        const article = match[0];
        const profile = blumProfiles.get(article);
        if (profile) found.push(entry('Направляющие BLUM LEGRABOX ' + article,
            'Класс нагрузки пары корпусных направляющих — ' + profile.capacity + ' кг для номинальной длины ' + profile.length + ' мм при установке по схеме BLUM. При загрузке учитывайте массу самого выдвижного элемента и ограничения его конструкции.',
            sources.blum));
    }
    for (const [article, series, rawLength] of value.matchAll(boyardCodes)) {
        const length = Number(rawLength);
        const push = series.startsWith('28');
        if (push && length === 270) continue;
        const page = push ? 110 : 118;
        found.push(entry('Система выдвижения BOYARD ' + article,
            'Несущая способность пары направляющих — ' + boyardCapacity.get(length) + ' кг при монтажной длине ' + length + ' мм и сборке по схеме производителя. При загрузке учитывайте конструкцию ящика и его крепление.',
            { title: 'BOYARD, каталог функциональной фурнитуры 2024, стр. ' + page, url: boyardCatalog + page + '/' }));
    }
    return found;
}

function instructionSnapshot(proposals, sourcesInContract) {
    const byId = new Map(proposals.map(proposal => [proposal.id, proposal.state]));
    const matches = new Map();
    for (const source of sourcesInContract) {
        const items = byId.get(source.id)?.items;
        if (!Array.isArray(items)) continue;
        items.forEach((item, index) => {
            const sections = Array.isArray(item?.specifications)
                ? item.specifications
                : FurnitureSpecifications.fromLegacy(item).sections;
            for (const section of sections) {
                if (typeof section?.value !== 'string') continue;
                const value = section.value.normalize('NFKC').toUpperCase();
                const rows = [];
                if (section.group === 'construction' && !unresolved.test(value)) rows.push(...materialRules(value));
                if (section.group === 'hardware' || section.type === 'interiorFilling' || (section.type === 'custom' && section.group === 'filling')) {
                    rows.push(...loadRules(value));
                }
                for (const row of rows) {
                    if (!matches.has(row.title)) matches.set(row.title, { ...row, positions: new Map() });
                    const positions = matches.get(row.title).positions;
                    if (!positions.has(source.appendix)) positions.set(source.appendix, new Set());
                    positions.get(source.appendix).add(index + 1);
                }
            }
        });
    }
    return {
        revision: REVISION,
        rules,
        regulation: sources.regulation,
        entries: [...matches.values()].map(row => ({
            ...row,
            positions: [...row.positions].map(([appendix, items]) => ({ appendix, items: [...items] })),
        })),
    };
}

module.exports = { TITLE, REVISION, instructionSnapshot };
