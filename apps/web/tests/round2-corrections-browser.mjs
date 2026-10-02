// Focused extension callbacks for the existing guarded coordinator. No launch/prepare/DB code.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {expect} from '@playwright/test';

export const round2CasePlan=Object.freeze({
 beforePrepare:'Root applies/verifies conversion46; signed fixture baseline is captured afterward.',
 emptyCover:'Replace classic photo(cover), do not upload this known media case twice: surface chooser proof, then actual drop.',
 filledBeforeCleanup:'Run product geometry/header/price/quantity/preview cases inside the already guarded admin page.',
 projectTab:'Navigate only the owned project/Product path; ProjectProductsTab cover navigates, main kanban viewer remains classic coverage.',
 dialogs:'Call width check whenever classic flow opens each ordinary dialog; fullscreen image variants are excluded.',
 previews:'Call after actual loaded cover/card/thumbnail and fullscreen; original bytes/hash remain classic upload guard coverage.',
 settings:'Manager authenticated HTTP GET/SSR DOM only; no settings action or form submit.',
 shared:'Classic journals, exact seven-file signed deletion, checkpoints, unknown-ACK STOP, native42 and post-conversion46 checks stay in Root coordinator.',
});
export function assertRound2Boundary({authorized,guardedTransportInstalled,origin,fixture,baselineProof}){
 assert.equal(authorized,true,'ROUND2_ROOT_AUTH_REQUIRED');assert.equal(guardedTransportInstalled,true,'ROUND2_GUARDED_TRANSPORT_REQUIRED');
 assert.ok(['http://127.0.0.1:3019','https://staging-crm.peromebel.by'].includes(origin),'ROUND2_ORIGIN_STOP');assert.equal(fixture?.checkpoint?.target,origin.startsWith('http:')?'local':'staging','ROUND2_TARGET_STOP');
 assert.equal(baselineProof?.status,'VERIFIED','ROUND2_POST_CONVERSION_PROOF_REQUIRED');assert.equal(baselineProof.fixtureRunId,fixture.checkpoint.runId,'ROUND2_BASELINE_RUN_STOP');
 const converted=Date.parse(baselineProof.conversionCompletedAt),prepared=Date.parse(baselineProof.fixturePreparedAt);assert.ok(Number.isFinite(converted)&&Number.isFinite(prepared)&&prepared>=converted,'ROUND2_PREPARE_BEFORE_CONVERSION_STOP');
}
export function assertRound2CoverCase(item,fixture){
 assert.equal(item?.key,'cover','ROUND2_COVER_CASE_STOP');assert.equal(item.cover,true,'ROUND2_COVER_CASE_STOP');assert.equal(item.productId,fixture.ids.productA,'ROUND2_COVER_PRODUCT_STOP');
 assert.ok(Buffer.isBuffer(item.buffer)&&item.buffer.length>0&&item.buffer.length<10*1024*1024,'ROUND2_COVER_BYTES_STOP');assert.equal(createHash('sha256').update(item.buffer).digest('hex'),item.hash,'ROUND2_COVER_HASH_STOP');assert.equal(item.mimeType,'image/png','ROUND2_COVER_MIME_STOP');
}
export function assertRound2DraftSum(price,quantity,text){
 const unit=price.trim().replace(',','.'),count=Number(quantity),known=/^[0-9]{1,10}(?:\.[0-9]{1,2})?$/.test(unit)&&/^[0-9]{1,10}$/.test(quantity)&&count>=1&&count<=2147483647;
 if(!known){assert.ok(/—|не определено/.test(text),'ROUND2_NULL_SUM_BECAME_ZERO_STOP');return;}
 const [whole,fraction='']=unit.split('.'),expected=BigInt(whole+fraction.padEnd(2,'0'))*BigInt(quantity);if(expected>999999999999n){assert.ok(/—|не определено/.test(text),'ROUND2_OVERFLOW_SUM_STOP');return;}const shown=text.replace(/\s/g,'').match(/^Сумма:([0-9]+)(?:[.,]([0-9]{1,2}))?BYN$/);assert.ok(shown,'ROUND2_SUM_TEXT_STOP');assert.equal(BigInt(shown[1]+(shown[2]??'').padEnd(2,'0')),expected,'ROUND2_SUM_MATH_STOP');
}
const settled=async page=>{await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));};
const ownedPage=(page,fixture)=>assert.ok([fixture.paths.productA,fixture.paths.productB].includes(new URL(page.url()).pathname),'ROUND2_OWN_PRODUCT_PAGE_STOP');
export function createRound2CorrectionsExtension(options){
 assertRound2Boundary(options);const{fixture,origin}=options;
 return{
  async product(page,{allowQuantityWrites=false,expectedContacts}={}){
   ownedPage(page,fixture);await settled(page);const checks=[];
   const hero=page.locator('[data-slot="product-cover-image"]');await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await settled(page);
   const before=await hero.evaluate(node=>({top:node.getBoundingClientRect().top,y:scrollY,position:getComputedStyle(node).position}));assert.ok(!['sticky','fixed'].includes(before.position),'ROUND2_HERO_POSITION_STOP');
   await page.evaluate(()=>window.scrollBy({top:120,behavior:'instant'}));await settled(page);const after=await hero.evaluate(node=>({top:node.getBoundingClientRect().top,y:scrollY}));assert.ok(after.y>before.y,'ROUND2_SCROLL_NOT_EXERCISED_STOP');assert.equal(Math.round((after.top-before.top)*100),Math.round(-(after.y-before.y)*100),'ROUND2_HERO_FOLLOWS_SCROLL_STOP');await page.evaluate(y=>window.scrollTo({top:y,behavior:'instant'}),before.y);await settled(page);checks.push('hero ordinary document movement equals actual window scroll delta');
   const header=page.locator('[data-product-header="stacked"]'),back=await header.getByRole('link',{name:'Назад к проекту',exact:true}).boundingBox(),status=await header.getByRole('combobox',{name:'Сменить статус',exact:true}).boundingBox(),del=await header.getByRole('button',{name:'Удалить',exact:true}).boundingBox();
   if(await page.evaluate(()=>innerWidth)>=1024){assert.ok(back&&status&&del&&Math.abs(back.y-status.y)<=2&&Math.abs(status.y-del.y)<=2&&status.x>back.x&&del.x>status.x,'ROUND2_HEADER_SAME_ROW_STOP');}checks.push('header metadata/actions same row and right aligned on desktop');
   const group=page.locator('[data-product-price-quantity]');await expect(group.getByLabel('Цена, BYN',{exact:true})).toBeVisible();await expect(group.locator('#product-inline-quantity')).toBeVisible();await expect(group.getByText(/^Сумма:/)).toBeVisible();
   assertRound2DraftSum(await group.getByLabel('Цена, BYN',{exact:true}).inputValue(),await group.locator('#product-inline-quantity').inputValue(),await group.getByText(/^Сумма:/).innerText());
   if(allowQuantityWrites){const qty=group.locator('#product-inline-quantity'),state=page.locator('#product-inline-quantity-state'),original=await qty.inputValue();await qty.fill('1');await qty.press('Enter');await expect(state.getByText('Сохранено',{exact:true})).toBeVisible();await group.getByRole('button',{name:'Уменьшить количество на 1',exact:true}).click();await expect(qty).toHaveValue('1');await group.getByRole('button',{name:'Увеличить количество на 1',exact:true}).click();await expect(state.getByText('Сохранено',{exact:true})).toBeVisible();await expect(qty).toHaveValue('2');await qty.fill(original);await qty.press('Enter');await expect(state.getByText('Сохранено',{exact:true})).toBeVisible();checks.push('existing owned scalar controller quantity step1/min1 and saved ACK');}
   for(const kind of ['ASSEMBLY','INSTALLATION']){const section=page.locator(`[data-single-percentage-kind="${kind}"]`);assert.equal(await section.getByText(/База:|По сохранённым|Получатель не назначен/).count(),0,'ROUND2_EXTRA_PERCENTAGE_HELPER_STOP');await expect(section.getByText(/^Предварительно:/)).toBeVisible();if(await page.evaluate(()=>innerWidth)>=1024){const box=await section.locator(`#${kind.toLowerCase()}-rate`).boundingBox();assert.ok(box&&Math.abs(box.width-192)<=2,'ROUND2_RATE_WIDTH_STOP');}}
   assert.equal(await page.getByText(/Работ не назначено — добавляются из прайса со снимком цены|Клик по задаче — просмотр и редактирование\. Замер требует фото/).count(),0,'ROUND2_EXPLANATORY_TEXT_STOP');
   assert.equal(await page.locator('input#product-inline-phone,input#product-inline-address,[data-product-contacts] input:not([id="product-inline-client"])').count(),0,'ROUND2_WRITABLE_CONTACT_STOP');if(expectedContacts){await expect(page.locator('#product-client-phone')).toContainText(expectedContacts.phone);await expect(page.locator('#product-client-address')).toContainText(expectedContacts.address);}
   checks.push('Price/Qty/Sum grouped, percentage preview-only helpers, readonly client contacts');return checks;
  },
  async emptyCoverUpload(page,item,{waitForCapturedUpload}){
   ownedPage(page,fixture);assertRound2CoverCase(item,fixture);assert.equal(typeof waitForCapturedUpload,'function','ROUND2_DURABLE_UPLOAD_ACK_REQUIRED');
   const surface=page.locator('[data-slot="product-cover-image"][data-sketch-state="empty"] [data-sketch-dropzone]');await surface.waitFor();const button=surface.getByRole('button',{name:'Добавить изображение',exact:true});await expect(button).toBeVisible();const colors=await button.evaluate(node=>{const color=value=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};const style=getComputedStyle(node);return{background:color(style.backgroundColor),text:color(style.color)};});assert.ok(colors.background.slice(0,3).every(value=>value<10)&&colors.text.slice(0,3).every(value=>value>245),'ROUND2_SKETCH_BLACK_WHITE_BUTTON_STOP');assert.equal(await surface.locator('svg.lucide-camera').count(),0,'ROUND2_SKETCH_CAMERA_STOP');
   const chooserPromise=page.waitForEvent('filechooser');await surface.click({position:{x:12,y:12}});const chooser=await chooserPromise;await chooser.setFiles([]);
   const transfer=await page.evaluateHandle(({base64,name,mimeType})=>{const bytes=Uint8Array.from(atob(base64),ch=>ch.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],name,{type:mimeType}));return dt;},{base64:item.buffer.toString('base64'),name:item.name,mimeType:item.mimeType});
   try{await surface.dispatchEvent('dragover',{dataTransfer:transfer});await surface.dispatchEvent('drop',{dataTransfer:transfer});}finally{await transfer.dispose();}
   const ack=await waitForCapturedUpload(item.key);assert.ok(ack?.ok&&typeof ack.id==='string','ROUND2_UPLOAD_NOT_CONFIRMED_STOP');await expect(page.locator('[data-sketch-state="filled"]')).toBeVisible();const trash=page.getByRole('button',{name:'Удалить эскиз',exact:true}).locator('svg');const red=await trash.evaluate(node=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(node).color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]});assert.ok(red[0]>red[1]+30&&red[0]>red[2]+30,'ROUND2_SKETCH_TRASH_RED_STOP');return{handled:true,uploadedId:ack.id,checks:['actual empty surface opens chooser; actual DROPZONE drop uploads exact guarded original bytes']};
  },
  async projectTab(page,{expectedContacts}={}){
   assert.equal(new URL(page.url()).pathname,fixture.paths.project,'ROUND2_OWN_PROJECT_STOP');
   await page.getByRole('tab',{name:'Общее',exact:true}).click();
   if(expectedContacts){await expect(page.locator('#project-client-phone')).toContainText(expectedContacts.phone);await expect(page.locator('#project-client-address')).toContainText(expectedContacts.address);}assert.equal(await page.locator('input#project-inline-phone,input#project-inline-address').count(),0,'ROUND2_PROJECT_WRITABLE_CONTACT_STOP');
   await page.getByRole('tab',{name:/^Изделия/}).click();
   const card=page.locator('[data-slot="product-kanban-card"]').filter({hasText:fixture.numbers.productA});await expect(card).toHaveCount(1);const number=card.getByText(fixture.numbers.productA,{exact:true});const style=await number.evaluate(node=>({font:Number.parseFloat(getComputedStyle(node).fontSize),parent:Number.parseFloat(getComputedStyle(node.parentElement).fontSize),weight:Number(getComputedStyle(node).fontWeight)}));assert.ok(Math.abs(style.font/style.parent-1.25)<=0.02&&style.weight>=600,'ROUND2_NUMBER_ONLY_SCALE_STOP');await card.locator('[data-slot="product-kanban-image"]').click();await page.waitForURL(url=>url.pathname===fixture.paths.productA);assert.equal(await page.locator('[data-file-viewer-variant]').count(),0,'ROUND2_PROJECT_COVER_OPENED_VIEWER_STOP');return['project contacts readonly; number-only bold125%; ProjectProductsTab cover navigates to owned product'];
  },
  async modal(page,dialog){
   await settled(page);const variant=await dialog.getAttribute('data-file-viewer-variant');if(['cover-fullscreen','image-fullscreen'].includes(variant))return['fullscreen image dialog excluded from ordinary width576'];
   const box=await dialog.boundingBox(),viewport=await page.evaluate(()=>innerWidth);assert.ok(box&&box.x>=0&&box.x+box.width<=viewport+1,'ROUND2_MODAL_MOBILE_OVERFLOW_STOP');if(viewport>=640)assert.ok(Math.abs(box.width-576)<=2,'ROUND2_MODAL_DESKTOP_WIDTH_STOP');return['actual ordinary modal576 desktop/mobile fit'];
  },
  async preview(image,variant){await expect.poll(()=>image.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);const src=await image.getAttribute('src');assert.ok(src,'ROUND2_PREVIEW_SOURCE_MISSING');const url=new URL(src,origin);assert.equal(url.origin,origin,'ROUND2_FOREIGN_IMAGE_STOP');assert.ok(/^\/api\/files\/[a-z0-9-]+$/i.test(url.pathname),'ROUND2_UNPROTECTED_IMAGE_PATH_STOP');if(variant==='original')assert.equal(url.searchParams.has('preview'),false,'ROUND2_FULLSCREEN_NOT_ORIGINAL_STOP');else assert.equal(url.searchParams.get('preview'),variant,'ROUND2_WRONG_PREVIEW_VARIANT_STOP');return[`actual ${variant} protected image source`];},
  async rightThumbnail(row,fileName){const img=row.locator('img'),text=row.getByText(fileName,{exact:true}),picture=await img.boundingBox(),caption=await text.boundingBox();assert.ok(picture&&caption&&picture.x>caption.x+caption.width-2,'ROUND2_THUMB_NOT_RIGHT_STOP');return['actual thumbnail is right of filename'];},
  async managerSettings(context){
   const response=await context.request.get(`${origin}/settings/product-percentages`,{maxRedirects:0});assert.equal(response.status(),200,'ROUND2_MANAGER_SETTINGS_READ_STOP');const html=await response.text();for(const id of ['default-ENGINEERING','default-ASSEMBLY','default-INSTALLATION'])assert.ok(html.includes(`id="${id}"`),'ROUND2_SETTINGS_THREE_FIELDS_STOP');
   for(const route of ['/settings/users','settings/plugins','settings/payroll'].map(value=>value.startsWith('/')?value:`/${value}`)){const blocked=await context.request.get(`${origin}${route}`,{maxRedirects:0});assert.ok([302,303,307,308,401,403,404].includes(blocked.status()),'ROUND2_OTHER_ADMIN_ROUTE_ALLOWED_STOP');}return['manager authenticated settings GET contains3rates; other admin routes denied; no settings writes'];
  },
 };
}
