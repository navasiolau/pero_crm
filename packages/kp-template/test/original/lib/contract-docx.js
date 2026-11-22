'use strict';

const fs = require('fs');
const path = require('path');
const { patchDocument, PatchType, Paragraph, TextRun, ImageRun, AlignmentType } = require('docx');
const Model = require('../public/js/contract-model');

const TEMPLATE_VERSION = 1;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function paragraph(text, options) {
    return new Paragraph(Object.assign({ children: [new TextRun({ text: text, font: 'Garamond', size: 24 })], spacing: { line: 276, after: 80 }, alignment: AlignmentType.JUSTIFIED }, options));
}

function block(lines) {
    return { type: PatchType.DOCUMENT, children: lines.map((line, index) => paragraph(line, { keepNext: index < lines.length - 1 })) };
}

function days(count, unit) {
    return count + ' ' + Model.plural(count, unit === 'working' ? ['рабочий день', 'рабочих дня', 'рабочих дней'] : ['календарный день', 'календарных дня', 'календарных дней']);
}

function termsText(settings, summary, key, unitKey) {
    function value(terms) {
        return unitKey ? days(terms[key], terms[unitKey]) : terms[key] + ' (' + Model.integerWords(terms[key]) + ') ' + Model.plural(terms[key], ['месяц', 'месяца', 'месяцев']);
    }
    if (!summary.sources.some(source => source.terms[key] !== settings[key] || unitKey && source.terms[unitKey] !== settings[unitKey])) return value(settings);
    return summary.sources.map(source => 'по КП №' + source.number + ' (Приложение №' + source.appendix + ') — ' + value(source.terms)).join('; ');
}

function customerPreamble(customer) {
    if (customer.type === 'organization') return customer.name + ', от имени которого договор подписывает ' + [customer.position, customer.representative].filter(Boolean).join(' ') + ' на основании ' + customer.authority + ', далее «Заказчик»';
    return (customer.type === 'soleProprietor' ? 'Индивидуальный предприниматель ' : '') + customer.name + ', далее «Заказчик»';
}

function details(profile) {
    return ['Наименование: ' + profile.name, 'Адрес: ' + profile.address, (profile.country === 'BY' ? 'УНП: ' : 'ИНН / КПП: ') + profile.taxId].concat(profile.bankDetails.split('\n')).concat(['Email: ' + profile.email, 'Тел.: ' + profile.phones.join('; '), 'Сайт: ' + profile.site]);
}

function customerDetails(settings) {
    const customer = settings.customer;
    return [customer.name, 'Адрес: ' + (customer.registrationAddress || settings.deliveryAddress), customer.taxId && 'ИНН / УНП: ' + customer.taxId, customer.registrationId && 'Регистрационный номер: ' + customer.registrationId, customer.passport && 'Документ: ' + customer.passport, customer.bankDetails, customer.email && 'Email: ' + customer.email, customer.phone && 'Тел.: ' + customer.phone].filter(Boolean);
}

async function generateDocx(settings, summary, profile, rendered) {
    const date = settings.date.split('-');
    const contractDate = date.slice().reverse().join('.');
    const inline = {
        contract_number: settings.number, subject: settings.subject, city: settings.city,
        day: date[2], month: MONTHS[Number(date[1]) - 1], year: date[0], contract_date: contractDate,
        delivery_address: settings.deliveryAddress, executor_name: profile.name,
        executor_preamble: profile.name + ', в лице ' + profile.positionGenitive + ' ' + profile.directorGenitive + ', действующего на основании ' + profile.authority + ', далее «Исполнитель»',
        customer_preamble: customerPreamble(settings.customer),
        total_figure: Model.money(summary.totalMinor, summary.currency), total_words: Model.moneyWords(summary.totalMinor, summary.currency),
        project_appendix: String(summary.projectAppendix), act_appendix: String(summary.actAppendix),
        proposal_references: (summary.sources.length === 1 ? 'Приложение ' : 'Приложения ') + summary.sources.map(source => '№' + source.appendix).join(', '),
        production_terms: 'Срок изготовления Изделий на Производстве: ' + termsText(settings, summary, 'productionDays', 'productionUnit') + '.',
        installation_terms: 'Срок поставки, сборки и монтажа Изделий на объекте: ' + termsText(settings, summary, 'installationDays', 'installationUnit') + '.',
        warranty_terms: '7.1. Гарантийный срок на смонтированные Изделия составляет ' + termsText(settings, summary, 'warrantyMonths') + ' с момента окончания монтажа соответствующих Изделий.'
    };
    const patches = {};
    for (const [key, value] of Object.entries(inline)) patches[key] = { type: PatchType.PARAGRAPH, children: [new TextRun(String(value))] };
    const paymentBlocks = [paragraph('2.1.1. Оплата по настоящему договору осуществляется в ' + Model.integerWords(summary.payments.length) + ' ' + Model.plural(summary.payments.length, ['этап', 'этапа', 'этапов']) + ':')];
    summary.payments.forEach((payment, index) => {
        paymentBlocks.push(paragraph((index + 1) + '-й этап. ' + payment.condition + (payment.mode === 'percent' ? ' — ' + payment.value + '% от общей стоимости договора' : '') + ':', { keepNext: true }));
        paymentBlocks.push(paragraph(Model.money(payment.amountMinor, summary.currency) + ' (' + Model.moneyWords(payment.amountMinor, summary.currency) + ').'));
    });
    patches.payments = { type: PatchType.DOCUMENT, children: paymentBlocks };
    patches.executor_details = block(details(profile));
    patches.customer_details = block(customerDetails(settings));
    patches.executor_signature = block(['«Исполнитель»', profile.name, '', '________________ ' + profile.signature]);
    patches.customer_signature = block(['«Заказчик»', settings.customer.name, '', '________________ ' + (settings.customer.signature || settings.customer.representative || settings.customer.name)]);
    patches.appendix_list = block(summary.sources.map(source => 'Приложение №' + source.appendix + ' — КП №' + source.number + (source.date ? ' от ' + source.date : '') + ' / Спецификация материалов и объёмов работ.').concat(['Приложение №' + summary.projectAppendix + ' — Проект изделия в формате PDF, прилагается после внесения аванса первого этапа.', 'Приложение №' + summary.actAppendix + ' — Акт сдачи-приёмки выполненных работ.']));
    const appendices = [];
    for (const source of summary.sources) {
        const pages = rendered.find(value => value.id === source.id);
        if (!pages || !pages.images.length) throw new Error('Не подготовлены страницы КП №' + source.number);
        pages.images.forEach((image, index) => {
            appendices.push(paragraph('Приложение №' + source.appendix + ' · КП №' + source.number + ' · страница ' + (index + 1) + ' из ' + pages.images.length, { pageBreakBefore: true, keepNext: true, alignment: AlignmentType.LEFT, spacing: { after: 30 }, children: [new TextRun({ text: 'Приложение №' + source.appendix + ' · КП №' + source.number + ' · страница ' + (index + 1) + ' из ' + pages.images.length, font: 'Garamond', size: 19, bold: true })] }));
            appendices.push(paragraph('к Договору №' + settings.number + ' от ' + contractDate, { keepNext: true, alignment: AlignmentType.LEFT, spacing: { after: 40 }, children: [new TextRun({ text: 'к Договору №' + settings.number + ' от ' + contractDate, font: 'Garamond', size: 18 })] }));
            appendices.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: image, transformation: { width: 620, height: 620 * 297 / 210 }, altText: { name: 'КП ' + source.number + ', страница ' + (index + 1), title: 'Страница коммерческого предложения', description: 'Приложение ' + source.appendix } })], spacing: { before: 0, after: 0 }, alignment: AlignmentType.CENTER }));
        });
    }
    appendices.push(paragraph('Приложение №' + summary.projectAppendix, { pageBreakBefore: true, keepNext: true }));
    appendices.push(paragraph('к Договору №' + settings.number + ' от ' + contractDate, { keepNext: true }));
    appendices.push(paragraph('Проект изделия', { keepNext: true }));
    appendices.push(paragraph('Проект изделия, выполненный в формате PDF, передаётся Заказчику после внесения аванса первого этапа и является неотъемлемой частью настоящего Договора.'));
    patches.proposal_appendices = { type: PatchType.DOCUMENT, children: appendices };
    return patchDocument({ outputType: 'nodebuffer', data: fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'contracts', 'furniture.docx')), keepOriginalStyles: true, patches: patches });
}

module.exports = { generateDocx, TEMPLATE_VERSION };
