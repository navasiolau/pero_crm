import test from 'node:test';
import { runScrollRestorationBrowser } from './kanban-scroll-restoration-browser.mjs';
import { runKanbanTouchScrollBrowser } from './kanban-touch-scroll-browser.mjs';

test('доски восстанавливают обе оси, карточку и нижнюю полосу после возврата', { timeout: 120000 }, async () => {
  await runScrollRestorationBrowser();
});

test('нативные touch-свайпы канбана не получают обратных записей от нижней полосы', { timeout: 90000 }, async () => {
  await runKanbanTouchScrollBrowser();
});
