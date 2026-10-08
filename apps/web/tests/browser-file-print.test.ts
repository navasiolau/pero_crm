import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchPrintableFile, getPrintableFileKind, getImagePrintPage } from '../src/lib/browser-file-print';
import type { ViewableFile } from '../src/lib/viewable-file';

const file: ViewableFile = { id: 'file-116', fileName: 'Эскиз.png', mimeType: 'image/png' };
const pdf: ViewableFile = { ...file, fileName: 'Документ.pdf', mimeType: 'application/pdf' };
const pdfBytes = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n9\n%%EOF\n';
const okFetch: typeof fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });

for (const mimeType of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/svg+xml', 'image/apng', 'image/x-icon']) {
 test(`кнопка допускается для browser image ${mimeType}`, () => assert.equal(getPrintableFileKind({ mimeType }), 'image'));
}
for (const mimeType of ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'image/tiff', 'image/heic', 'video/mp4', 'text/html', 'image/unknown']) {
 test(`неподдерживаемый ${mimeType} не имеет печати`, () => assert.equal(getPrintableFileKind({ mimeType }), null));
}
test('PDF определяется MIME, параметры/регистр допускаются', () => {
 assert.equal(getPrintableFileKind({ mimeType: 'Application/PDF; charset=binary' }), 'pdf');
 assert.equal(getPrintableFileKind({ mimeType: '' }), null);
});
test('проектный оригинал и финансовый PDF используют только защищённые routes', async () => {
 const calls: Array<{ url: string; init?: RequestInit }> = [];
 const fetcher: typeof fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return String(url).includes('finance') ? new Response(pdfBytes, { headers: { 'Content-Type': 'application/pdf' } }) : okFetch(url, init);
 };
 assert.deepEqual(new Uint8Array(await (await fetchPrintableFile(file, { fetcher })).arrayBuffer()), new Uint8Array([137,80,78,71]));
 assert.equal(await (await fetchPrintableFile({ ...pdf, source: 'finance' }, { fetcher })).text(), pdfBytes);
 assert.deepEqual(calls.map(call => call.url), ['/api/files/file-116', '/api/finance/documents/file-116?view=1']);
 for (const { init } of calls) {
  assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
 }
});
for (const status of [401,403,404,500]) {
 test(`ответ ${status} не передаётся печати`, async () => {
  await assert.rejects(fetchPrintableFile(file, { fetcher: async () => new Response('denied', { status }) }), /доступ|загрузить/i);
 });
}
test('страница входа, несоответствующий MIME, пустые байты и поддельный PDF отклоняются', async () => {
 for (const response of [new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('PDF', { headers: { 'Content-Type': 'application/pdf' } }), new Response('', { headers: { 'Content-Type': 'image/png' } })]) {
  await assert.rejects(fetchPrintableFile(file, { fetcher: async () => response }), /формат|пуст/i);
 }
 for (const body of ['<html>login</html>', '%PDF-1.7\nbroken']) {
  await assert.rejects(fetchPrintableFile(pdf, { fetcher: async () => new Response(body, { headers: { 'Content-Type': 'application/pdf' } }) }), /PDF/i);
 }
});
test('произвольные URL и пути не допускаются через id', async () => {
 let calls = 0;
 for (const id of ['', '../../login', 'https://external.invalid/a', 'id?view=1', 'id#fragment', 'id/other']) {
  await assert.rejects(fetchPrintableFile({ ...file, id }, { fetcher: async () => { calls++; return okFetch(''); } }), /файл/i);
 }
 assert.equal(calls, 0);
});
test('отмена перед fetch не читает файл', async () => {
 const controller = new AbortController(); controller.abort(); let calls = 0;
 await assert.rejects(fetchPrintableFile(file, { signal: controller.signal, fetcher: async () => { calls++; return okFetch(''); } }), { name: 'AbortError' });
 assert.equal(calls,0);
});
test('изображение вписывается целиком на страницу с ориентацией по пропорциям', () => {
 assert.deepEqual(getImagePrintPage(400,1600), { orientation:'portrait', widthMm:210, heightMm:297 });
 assert.deepEqual(getImagePrintPage(1600,400), { orientation:'landscape', widthMm:297, heightMm:210 });
 assert.equal(getImagePrintPage(600,600).orientation,'portrait');
});
