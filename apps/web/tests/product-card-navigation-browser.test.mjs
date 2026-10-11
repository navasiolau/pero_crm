import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {CardBrowserFailure,fixtureRequestAllowed,launchCardBrowser,runProductCardNavigationGate} from './product-card-navigation-browser.mjs';

test('cold import does not start browser, HTTP, Next or Prisma',()=>{
 const code="import {createRequire,syncBuiltinESMExports} from 'node:module';const require=createRequire(import.meta.url);require('node:http').createServer=()=>{throw Error('HTTP_STARTED_ON_IMPORT')};syncBuiltinESMExports();process.env.DATABASE_URL='FAKE_SECRET_WRONG_TARGET';const m=await import("+JSON.stringify(new URL('./product-card-navigation-browser.mjs',import.meta.url).href)+");console.log(typeof m.runProductCardNavigationGate==='function'?'COLD_ONLY':'BAD');";
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0);assert.equal(result.stdout.trim(),'COLD_ONLY');assert.equal(result.stderr,'');
});

test('fixture refuses unknown paths, mutations and external origins',()=>{
 for(const [method,url]of [['POST','/project?variant=baseline'],['GET','/api/users'],['GET','https://example.invalid/project?variant=baseline'],['GET','/project?variant=unknown'],['GET','/api/files/real-id?preview=cover']])
  assert.equal(fixtureRequestAllowed(method,url),false);
 assert.equal(fixtureRequestAllowed('GET','/project?variant=baseline'),true);
 assert.equal(fixtureRequestAllowed('GET','/api/files/qa160-a-cover?preview=cover'),true);
 assert.equal(fixtureRequestAllowed('GET','/api/files/qa160-a-cover?preview=card'),true);
 assert.equal(fixtureRequestAllowed('GET','/api/files/qa160-a-cover?thumb=1'),false);
 assert.equal(fixtureRequestAllowed('GET','/api/files/qa160-a-cover?preview=card&preview=cover'),false);
});

test('missing browser gives BLOCKED failure, never PASS or mutation killed',async()=>{
 await assert.rejects(launchCardBrowser(async()=>{throw Error('FAKE_SECRET: executable unavailable');}),error=>{
  assert.ok(error instanceof CardBrowserFailure);assert.equal(error.code,'BROWSER_UNAVAILABLE');assert.equal(error.phase,'browser-launch');
  assert.ok(!error.message.includes('FAKE_SECRET'));assert.equal(error.evidence.killed,undefined);return true;
 });
});

test('actual Chromium cover/body navigation, drag preview, mobile numbers and two faults',{timeout:180000},async()=>{
 const result=await runProductCardNavigationGate();
 assert.equal(result.status,'COMPONENT_RUNTIME_PASS');assert.equal(result.stagingStatus,'NOT_RUN');
 assert.equal(result.checks.length,4);assert.equal(result.mutants.length,4);assert.equal(result.numbers.length,2);
 assert.equal(result.cleanup.browserClosed,true);assert.equal(result.cleanup.serverClosed,true);
 assert.ok(result.browser);assert.equal(result.react,'19.1.0');
 console.log(JSON.stringify({status:result.status,browser:result.browser,checks:result.checks.length,mutants:result.mutants.length,directory:result.directory,stage:'NOT_RUN'}));
});
