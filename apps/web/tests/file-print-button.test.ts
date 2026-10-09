import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
let FilePrintButton: typeof import('../src/components/file-print-button').FilePrintButton;
before(() => {
 (globalThis as {React?: typeof React}).React = React;
 ({ FilePrintButton } = require('../src/components/file-print-button'));
});

test('кнопка принтера доступна PDF и изображению с русским названием и icon', () => {
 for (const mimeType of ['application/pdf','image/png']) {
  const markup = renderToStaticMarkup(React.createElement(FilePrintButton, { file:{id:'f116',fileName:'Чертёж <эскиз>.pdf',mimeType} }));
  assert.match(markup,/aria-label="Распечатать Чертёж &lt;эскиз&gt;\.pdf"/);
  assert.match(markup,/type="button"/); assert.match(markup,/lucide-printer/);
  assert.doesNotMatch(markup,/download|iframe|img src/);
 }
});
test('DOCX, таблицы, CAD, видео и TIFF не получают кнопку', () => {
 for (const mimeType of ['application/octet-stream','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','video/mp4','image/tiff']) {
  assert.equal(renderToStaticMarkup(React.createElement(FilePrintButton, { file:{id:'f116',fileName:'File.b3d',mimeType} })), '');
 }
});
test('запрет на внешнее действие выключает кнопку печати', () => {
 const markup = renderToStaticMarkup(React.createElement(FilePrintButton, {file:{id:'f116',fileName:'File.png',mimeType:'image/png'},disabled:true}));
 assert.match(markup,/disabled=""/);
});
