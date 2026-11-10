import test from 'node:test';
import { runScrollRestorationBrowser } from './kanban-scroll-restoration-browser.mjs';

test('доски восстанавливают обе оси, карточку и нижнюю полосу после возврата', { timeout: 120000 }, async () => {
  await runScrollRestorationBrowser();
});
