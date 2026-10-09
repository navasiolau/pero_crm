/** Native Chrome QA only. Import opens no browser, request, printer or file. */
const check = (ok, code) => {if (!ok) throw Error(`F116_${code}`);};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Reuses the locally accepted actual-preview CDP flow. The only UI action after opening is Cancel. */
export async function inspectNativeFilePrintPreview({browser, trigger, isPdf, saveScreenshot, timeoutMs = 15000, settleMs = 2500}) {
 check(typeof browser?.newBrowserCDPSession === 'function' && typeof trigger === 'function' && typeof isPdf === 'boolean', 'NATIVE_ARGUMENTS_REQUIRED');
 check(Number.isFinite(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30000 && Number.isFinite(settleMs) && settleMs >= 0 && settleMs <= 3000, 'NATIVE_TIMING_INVALID');
 const cdp = await browser.newBrowserCDPSession();
 let target, sessionId, sequence = 1, canceled = false;
 const pending = new Map();
 const onMessage = event => {
  if (event.sessionId !== sessionId) return;
  let payload;try {payload = JSON.parse(event.message);} catch {return;}
  const reply = pending.get(payload.id);if (reply) {pending.delete(payload.id);reply(payload);}
 };
 cdp.on('Target.receivedMessageFromTarget', onMessage);
 async function raw(method, params = {}) {
  const id = sequence++;
  const reply = new Promise((resolve, reject) => {
   const timer = setTimeout(() => {pending.delete(id);reject(Error('F116_NATIVE_CDP_TIMEOUT'));}, Math.min(timeoutMs, 5000));
   pending.set(id, payload => {clearTimeout(timer);if (payload.error) reject(Error('F116_NATIVE_CDP_FAILED'));else resolve(payload);});
  });
  try {await cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})});}
  catch {const fail = pending.get(id);pending.delete(id);fail?.({error:true});}
  return reply;
 }
 async function cancel() {
  if (!target || canceled) return;
  if (sessionId) {
   const result = await raw('Runtime.evaluate', {expression: `(()=>{function find(root){for(const button of root.querySelectorAll('button,cr-button'))if(/^(Cancel|Отмена)$/.test(button.textContent.trim()))return button;for(const element of root.querySelectorAll('*'))if(element.shadowRoot){const match=find(element.shadowRoot);if(match)return match;}}const button=find(document);if(!button)return false;button.click();return true;})()`, returnByValue: true});
   check(result.result?.result?.value === true, 'NATIVE_CANCEL_MISSING');
  } else {await cdp.send('Target.closeTarget', {targetId: target.targetId});}
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
   if (!(await cdp.send('Target.getTargets')).targetInfos.some(info => info.targetId === target.targetId)) {canceled = true;return;}
   await pause(50);
  }
  throw Error('F116_NATIVE_CANCEL_NOT_CLOSED');
 }
 try {
  check(!(await cdp.send('Target.getTargets')).targetInfos.some(info => info.url === 'chrome://print/'), 'NATIVE_PREEXISTING_DIALOG');
  await trigger();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
   const matches = (await cdp.send('Target.getTargets')).targetInfos.filter(info => info.url === 'chrome://print/');
   check(matches.length <= 1, 'NATIVE_MULTIPLE_DIALOGS');
   if (matches.length) {target = matches[0];break;}await pause(50);
  }
  check(target, 'NATIVE_DIALOG_MISSING');
  ({sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: false}));
  let preview;
  while (Date.now() <= deadline) {
   const result = await raw('Runtime.evaluate', {expression: `(()=>{const app=document.querySelector('print-preview-app'),sidebar=app?.shadowRoot?.querySelector('print-preview-sidebar'),area=app?.shadowRoot?.querySelector('print-preview-preview-area');return {state:sidebar?.getAttribute('state'),pageCount:sidebar?.getAttribute('page-count'),isPdf:sidebar?.hasAttribute('is-pdf'),error:sidebar?.getAttribute('error'),previewLoaded:area?.shadowRoot?.querySelector('print-preview-margin-control-container')?.hasAttribute('preview-loaded')};})()`, returnByValue: true});
   preview = result.result?.result?.value;
   if (preview?.state === '1' && preview.previewLoaded) break;await pause(50);
  }
  check(preview?.state === '1' && preview.error === '0' && preview.previewLoaded === true && preview.pageCount === '1' && preview.isPdf === isPdf, 'NATIVE_PREVIEW_INVALID');
  await raw('Page.bringToFront');
  // Compositor settle is only for the image capture; native readiness above is checked independently.
  if (settleMs) await pause(settleMs);
  if (saveScreenshot) {
   check(typeof saveScreenshot === 'function', 'NATIVE_SCREENSHOT_SINK_INVALID');
   const capture = await raw('Page.captureScreenshot', {format: 'png'});
   check(typeof capture.result?.data === 'string' && capture.result.data.length > 0, 'NATIVE_SCREENSHOT_MISSING');
   await saveScreenshot(Buffer.from(capture.result.data, 'base64'));
  }
  await cancel();return {kind: 'actual-native-preview', preview, canceled: true, physicalPrintSubmitted: false};
 } finally {
  if (target && !canceled) await cancel().catch(async () => {await cdp.send('Target.closeTarget', {targetId: target.targetId}).catch(() => {});});
  cdp.off('Target.receivedMessageFromTarget', onMessage);
  await cdp.detach().catch(() => {});
 }
}
