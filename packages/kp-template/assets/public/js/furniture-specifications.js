(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FurnitureSpecifications = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';

    const GROUPS = Object.freeze([
        { id: 'construction', label: 'Конструкция' },
        { id: 'hardware', label: 'Фурнитура' },
        { id: 'lighting', label: 'Подсветка' },
        { id: 'filling', label: 'Наполнение' },
    ].map(Object.freeze));
    const CATALOG = Object.freeze([
        { type: 'body', group: 'construction', label: 'Корпус' },
        { type: 'facade', group: 'construction', label: 'Фасад' },
        { type: 'worktop', group: 'construction', label: 'Столешница' },
        { type: 'upholstery', group: 'construction', label: 'Обивка' },
        { type: 'insertsAndHandles', group: 'construction', label: 'Вставки и ручки' },
        { type: 'hardware', group: 'hardware', label: 'Фурнитура' },
        { type: 'lighting', group: 'lighting', label: 'Подсветка' },
        { type: 'interiorFilling', group: 'filling', label: 'Внутреннее наполнение' },
        { type: 'softFilling', group: 'filling', label: 'Мягкое наполнение' },
    ].map(Object.freeze));
    const byType = new Map(CATALOG.map(section => [section.type, section]));
    const byTitle = new Map(CATALOG.map(section => [section.label.toLowerCase(), section]));
    byTitle.set('каркас', byType.get('body'));
    const SOURCE_FIELDS = Object.freeze(['description', 'size', 'note']);
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const hasShape = (value, keys) => isObject(value) &&
        Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    const isNonblank = value => typeof value === 'string' && value.trim().length > 0;
    const asText = value => isNonblank(value) ? value : null;

    function empty() {
        return { sections: [], description: null, size: null, note: null, sourceGeneration: 0 };
    }

    function normalizeSection(input) {
        if (!hasShape(input, ['id', 'type', 'group', 'label', 'value']) ||
            !isNonblank(input.id) || !isNonblank(input.label) || typeof input.value !== 'string') return null;
        const { id, type, group, label, value } = input;
        const standard = byType.get(type);
        if (standard && (group !== standard.group || label !== standard.label)) return null;
        if (!standard && (type !== 'custom' || byType.has(id) || !GROUPS.some(item => item.id === group))) return null;
        return { id, type, group, label, value };
    }

    function normalize(input) {
        if (!hasShape(input, ['sections', ...SOURCE_FIELDS, 'sourceGeneration']) || !Array.isArray(input.sections) ||
            !Number.isSafeInteger(input.sourceGeneration) || input.sourceGeneration < 0 ||
            SOURCE_FIELDS.some(field => input[field] !== null && typeof input[field] !== 'string')) return null;
        const result = empty();
        result.sourceGeneration = input.sourceGeneration;
        const ids = new Set();
        const standardTypes = new Set();
        for (const raw of input.sections) {
            const section = normalizeSection(raw);
            if (!section || ids.has(section.id) || standardTypes.has(section.type)) return null;
            ids.add(section.id);
            if (section.type !== 'custom') standardTypes.add(section.type);
            result.sections.push(section);
        }
        for (const field of SOURCE_FIELDS) result[field] = input[field];
        return result;
    }

    /** Ручной список изделия сохраняет имена и порядок без правил каталога КП. */
    function normalizeProduct(input) {
        if (!hasShape(input, ['sections', ...SOURCE_FIELDS, 'sourceGeneration', ...(isObject(input) && Object.hasOwn(input, 'editRevision') ? ['editRevision'] : [])]) || !Array.isArray(input.sections) ||
            !Number.isSafeInteger(input.sourceGeneration) || input.sourceGeneration < 0 ||
            (input.editRevision !== undefined && (!Number.isSafeInteger(input.editRevision) || input.editRevision < 0)) ||
            SOURCE_FIELDS.some(field => input[field] !== null && typeof input[field] !== 'string')) return null;
        const result = empty();
        result.sourceGeneration = input.sourceGeneration;
        result.editRevision = input.editRevision ?? 0;
        const ids = new Set();
        for (const row of input.sections) {
            if (!hasShape(row, ['id', 'type', 'group', 'label', 'value']) || !isNonblank(row.id) ||
                typeof row.label !== 'string' || typeof row.value !== 'string' ||
                (!byType.has(row.type) && row.type !== 'custom') || !GROUPS.some(group => group.id === row.group) ||
                ids.has(row.id)) return null;
            ids.add(row.id);
            result.sections.push({ id: row.id, type: row.type, group: row.group, label: row.label, value: row.value });
        }
        return result;
    }

    function orderedSections(sections) {
        return GROUPS.flatMap(({ id }) => [
            ...CATALOG.filter(section => section.group === id)
                .flatMap(section => sections.filter(row => row.type === section.type)),
            ...sections.filter(section => section.group === id && section.type === 'custom'),
        ]);
    }

    function fromLegacy(input) {
        const result = empty();
        if (!isObject(input)) return result;
        for (const field of SOURCE_FIELDS) result[field] = asText(input[field]);
        if (!Array.isArray(input.products)) return result;
        const standardRows = new Map();
        function addStandard(standard, value) {
            const previous = standardRows.get(standard.type);
            if (previous) {
                if (value) previous.value = previous.value ? previous.value + '\n' + value : value;
                return;
            }
            const row = { id: standard.type, ...standard, value };
            standardRows.set(standard.type, row);
            result.sections.push(row);
        }
        input.products.forEach((block, index) => {
            if (!isObject(block)) return;
            const title = asText(block.title);
            const standard = title && byTitle.get(title.trim().toLowerCase());
            const outer = asText(block.outer);
            const inner = asText(block.inner);
            const addCustom = (key, label, value) => result.sections.push({
                id: 'legacy-' + index + '-' + key, type: 'custom', group: standard?.group ?? 'construction', label, value,
            });
            const materialLines = [
                outer && 'Материал наружный: ' + outer,
                inner && 'Материал внутренний: ' + inner,
            ].filter(Boolean);
            if (standard) {
                addStandard(standard, outer && !inner ? outer : materialLines.join('\n'));
            } else if (title) {
                addCustom('title', title, materialLines.join('\n'));
            } else {
                if (outer) addCustom('outer', 'Материал наружный', outer);
                if (inner) addCustom('inner', 'Материал внутренний', inner);
            }
            for (const [field, type] of [['hinges', 'hardware'], ['lighting', 'lighting'], ['drawers', 'interiorFilling']]) {
                const value = asText(block[field]);
                if (value) addStandard(byType.get(type), title ? title + ': ' + value : value);
            }
        });
        return result;
    }

    const productAliases = new Map(CATALOG.map(section => [section.label.toLowerCase(), section.type]));
    for (const [label, type] of [
        ['каркас', 'body'], ['фасадная часть', 'facade'],
        ['вставки/ручки', 'insertsAndHandles'], ['вставки / ручки', 'insertsAndHandles'],
        ['вставки', 'insertsAndHandles'], ['ручки', 'insertsAndHandles'], ['вставка в ручки', 'insertsAndHandles'],
        ['наполнение внутреннее', 'interiorFilling'], ['наполнение мягкое', 'softFilling'],
    ]) productAliases.set(label, type);

    function productType(label) {
        return typeof label === 'string' ? productAliases.get(label.trim().replace(/\s+/g, ' ').toLowerCase()) : undefined;
    }

    /** Проекция только постоянных полей изделия. Источник КП остаётся полным. */
    function forProduct(input) {
        const result = empty();
        if (!isObject(input)) return result;
        if (Number.isSafeInteger(input.sourceGeneration) && input.sourceGeneration >= 0)
            result.sourceGeneration = input.sourceGeneration;
        const rows = new Map();
        if (Array.isArray(input.sections)) for (const section of input.sections) {
            if (!isObject(section) || typeof section.value !== 'string') continue;
            const type = byType.has(section.type) ? section.type : section.type === 'custom' ? productType(section.label) : undefined;
            if (!type) continue;
            const previous = rows.get(type);
            const value = section.value;
            if (previous) {
                if (value.trim() && !previous.values.some(item => item.trim() === value.trim())) {
                    previous.values = previous.values.filter(item => item.trim());
                    previous.values.push(value);
                }
            } else {
                rows.set(type, { id: isNonblank(section.id) ? section.id : type, values: [value] });
            }
        }
        result.sections = CATALOG.filter(section => rows.has(section.type)).map(section => {
            const row = rows.get(section.type);
            return { id: row.id, ...section, value: row.values.join('; ') };
        });
        return result;
    }

    function fromProposalForProduct(input) {
        if (!isObject(input)) return empty();
        if (Array.isArray(input.specifications)) {
            const legacy = fromLegacy(input).sections;
            const productLegacy = fromProposalForProduct({ products: input.products }).sections;
            const sections = input.specifications.map(section => {
                if (!isObject(section)) return section;
                const unchangedLegacy = legacy.some(row =>
                    ['id', 'type', 'group', 'label', 'value'].every(key => row[key] === section[key]));
                const type = byType.has(section.type) ? section.type : productType(section.label);
                const projected = unchangedLegacy && productLegacy.find(row => row.type === type);
                return projected ? { ...section, value: projected.value } : section;
            });
            return forProduct({ sections });
        }
        const sections = [];
        if (Array.isArray(input.products)) for (const block of input.products) {
            if (!isObject(block)) continue;
            const type = productType(block.title);
            if (type) {
                for (const field of ['outer', 'inner']) {
                    if (typeof block[field] === 'string')
                        sections.push({ id: type, type, value: block[field] });
                }
                if (!sections.some(section => section.type === type))
                    sections.push({ id: type, type, value: '' });
            }
            for (const [field, kind] of [['hinges', 'hardware'], ['lighting', 'lighting'], ['drawers', 'interiorFilling']]) {
                if (isNonblank(block[field])) sections.push({ id: kind, type: kind, value: block[field] });
            }
        }
        return forProduct({ sections });
    }

    return Object.freeze({ GROUPS, CATALOG, SOURCE_FIELDS, empty, orderedSections, fromLegacy, normalize, normalizeProduct, normalizeSection, forProduct, fromProposalForProduct });
});
