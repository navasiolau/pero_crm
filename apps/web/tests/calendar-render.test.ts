import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
Object.assign(globalThis,{React});const require=createRequire(import.meta.url);
const id=require.resolve('../src/server/calendar/actions'),stub=new Module(id);stub.filename=id;stub.loaded=true;stub.exports={loadCalendarMonth:async()=>[],mutateCalendar:async()=>({ok:false})};require.cache[id]=stub;
const {PersonalCalendar}=require('../src/app/(app)/plan/personal-calendar') as typeof import('../src/app/(app)/plan/personal-calendar');
test('month calendar renders real own agenda and consistent explicit timezone with completed/cancelled restoration controls',()=>{
 const html=renderToStaticMarkup(React.createElement(PersonalCalendar,{initialMonth:'2026-10',initialDate:'2026-10-03',initialEntries:[{id:'own',title:'Meeting',description:'Private description',startsAt:'2026-10-03T09:00:00.000Z',state:'PLANNED',reminderOffsetMinutes:15,revision:0},{id:'done',title:'Done entry',description:'',startsAt:'2026-10-03T10:00:00.000Z',state:'COMPLETED',reminderOffsetMinutes:null,revision:1}]}));
 assert.ok(html.includes('Europe/Moscow'));assert.ok(html.includes('Meeting'));assert.ok(html.includes('Private description'));assert.ok(html.includes('12:00'));assert.ok(html.includes('Выполнить'));assert.ok(html.includes('Отменить запись'));assert.ok(html.includes('Вернуть в план'));assert.ok(html.includes('Без напоминания'));
 assert.equal((html.match(/aria-label="2026-\d\d-\d\d, записей:/g)??[]).length,42);assert.ok(html.includes('aria-pressed="true"'));assert.ok(html.includes('Добавить запись'));
});
