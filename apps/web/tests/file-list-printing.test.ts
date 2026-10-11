import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileList, FileListRow } from '../src/components/file-list';
import type { FileListItem } from '../src/lib/viewable-file';

Object.assign(globalThis, { React });
const original: FileListItem = { id:'print116', fileName:'Полный эскиз.png', mimeType:'image/png', canDelete:true };
const remove = async () => ({ ok:true });
function buttonFor(html: string, label: string) {
 return [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`aria-label="${label}"`));
}

test('обычная строка содержит printer перед урной и сохраняет оригинальное имя без миниатюр', () => {
 const html = renderToStaticMarkup(React.createElement(FileListRow, { file:original, onDelete:remove }));
 const printLabel = `Распечатать ${original.fileName}`, deleteLabel = `Удалить файл ${original.fileName}`;
 assert.ok(html.indexOf(printLabel) > 0 && html.indexOf(printLabel) < html.indexOf(deleteLabel));
 assert.ok(buttonFor(html, printLabel)); assert.ok(buttonFor(html, deleteLabel));
 assert.match(html,/data-file-id="print116"/); assert.match(html,/data-file-source="project"/);
 assert.doesNotMatch(html,/<img|<iframe|Скачать|Категория|Комментарий/);
});

test('финансовый PDF сохраняет защищённое скачивание; print доступен с read access при запрещённом удалении', () => {
 const file: FileListItem = { id:'finance116', fileName:'Отчёт.pdf', mimeType:'application/pdf', source:'finance', canDelete:false };
 const html = renderToStaticMarkup(React.createElement(FileListRow, { file, onDelete:remove }));
 assert.match(html,/href="\/api\/finance\/documents\/finance116" download="Отчёт\.pdf"/);
 assert.match(html,/data-file-source="finance"/);
 const printer = buttonFor(html,'Распечатать Отчёт.pdf'), trash = buttonFor(html,'Удалить файл Отчёт.pdf');
 assert.ok(printer); assert.doesNotMatch(printer,/\sdisabled=""/); assert.ok(trash); assert.match(trash,/\sdisabled=""/);
 assert.doesNotMatch(html,/<iframe|target="_blank"|\?view=1/);
});

test('неподдерживаемые документы в общем списке не получают принтер', () => {
 const files: FileListItem[] = [
  { ...original, id:'cad116', fileName:'Шкаф.b3d', mimeType:'application/octet-stream' },
  { ...original, id:'word116', fileName:'Заказ.docx', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { ...original, id:'video116', fileName:'Монтаж.mp4', mimeType:'video/mp4' },
 ];
 const html = renderToStaticMarkup(React.createElement(FileList, { files, onDelete:remove }));
 assert.doesNotMatch(html,/Распечатать|lucide-printer|<video|<iframe/);
 assert.equal((html.match(/aria-label="Удалить файл /g)??[]).length,3);
 assert.equal((html.match(/download=/g)??[]).length,3);
});

test('row disabled блокирует принтер и урну; отсутствие edit permission само по себе не блокирует print', () => {
 const busy = renderToStaticMarkup(React.createElement(FileListRow, { file:original, onDelete:remove, disabled:true }));
 assert.match(buttonFor(busy,'Распечатать Полный эскиз.png')!,/\sdisabled=""/);
 assert.match(buttonFor(busy,'Удалить файл Полный эскиз.png')!,/\sdisabled=""/);
 const readonly = renderToStaticMarkup(React.createElement(FileListRow, { file:original }));
 assert.doesNotMatch(buttonFor(readonly,'Распечатать Полный эскиз.png')!,/\sdisabled=""/);
 assert.match(buttonFor(readonly,'Удалить файл Полный эскиз.png')!,/\sdisabled=""/);
});
