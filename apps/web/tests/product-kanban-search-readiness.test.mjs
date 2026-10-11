// Один harness проверяет реальные Views/DnD/Base UI/hook; отдельный entry сохраняет regression145.
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('product kanban confirms filtered rows once and preserves stale-query/roles/caret/manual-scroll guards145',()=>{
 const output=execFileSync(process.execPath,[path.join(web,'tests/kanban-search-focus-browser.mjs'),'products'],{cwd:web,encoding:'utf8',timeout:120000,windowsHide:true});
 const receipt=JSON.parse(output.trim().split('\n').at(-1));assert.equal(receipt.status,'PASS');
 for(const contract of ['current_response_old_rows_unready','new_roles_wait_for_applied_permission_filter','manual_scroll_and_SSE_no_recenter','pending_and_stale_RSC','clear_reenter_same_exact_number','active_DnD_defers_focus','optimistic_rows_wait_for_authoritative_response_success','optimistic_rows_wait_for_authoritative_response_confirmed_rollback','Sheet_wait_complete_close_center'])assert.ok(receipt.checks.some(check=>check.includes(contract)),contract);
 assert.equal(receipt.screenshots.length,3);
});
