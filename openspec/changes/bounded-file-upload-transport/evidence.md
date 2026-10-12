# Evidence

## Актуальное состояние 11.10.2026

Приоритетный итог: production source ранее прошёл 67 affected regressions; реальные storage/DB/Next/staging проверки ещё не завершены. Пункты ниже — исторические записи на момент их создания, а не текущая приёмка.

QA keepalive race подтверждён actual RED851d (result2d9c), исправлен только sender: request.close отвергается до response headers; после headers решение принимает response reader. Actual GREEN580e result8c759 прошёл три positive и три negative controls, own sockets/timers0. Worker warmup CFA actual resultd748a03f… прошёл2×64КиБ/131072bytes/2mockputs/errors0; own handle exit0, spool removed, source12666 unchanged (postcdbc…). Это не RSS SLO и не real storage proof.

Полная матрица4ef7 остановилась RSS139_MEMORY_BOUND до первого completed case. STOPacfb54cd… и PRE8e201444… сохраняются; own handle exitSIGTERM известен, пустой UUID spool сохранён UNKNOWN_RETAINED. Postfb79eee… подтверждает12666 source pins без изменения. Старый footer generic SOURCE_PREPARE_GUARD не является фактической причиной; количественные baseline/peak были потеряны в исходном catch.

Текущая QA диагностика: entrybad825de…/suitef3fefb…, новый helper сохраняет durable known-case receipt с точными scalar baseline/peak/signed delta/32-64limit/status/size/parallel/sourceHash ДО прежнего memorygate. STOP ссылается на receipt. Negative deltas разрешены, falsy write0 не становится PASS; никакого GC/нового baseline/повышения лимитов/изменения bridge или приложения. New cold REDed4a65→GREEN754be7(2/2), lintb76e19(0/0), fullwebTSC44351→62df01 exit0. Предыдущие32cold не перезапускались, sourcebytes015d сохранены отдельно.

Новый numeric RSS пакет284d9125: private ready SHA903d094a…/source5d870f9d…, проверены12666 physical pins, ровно2QA delta, прежняя matrix9487/32-64MiB/600000ms. PROPOSED_NOT_AUTHORIZED; actual run и memory PASS отсутствуют.

Статический разбор bridge: установленный Next15.5.20 request.js2490a352… передаёт body в Request, node adapter006db434… использует raw Node body. Upload исключён из middleware matcher76372477…. QA toWeb использует byte-sized64КиБ queue. Node22.23.1 [primary adapter](https://raw.githubusercontent.com/nodejs/node/v22.23.1/lib/internal/webstreams/adapters.js) останавливает источник при заполнении очереди и копирует отдельные Buffer chunks; полный запрос этот путь не собирает. [Primary extractBody](https://raw.githubusercontent.com/nodejs/node/v22.23.1/deps/undici/src/lib/web/fetch/body.js) сохраняет переданный Web stream, а для async iterable строит поток. Наличие дополнительных chunk copies отличается от production bridge; их вклад в MEMORY_BOUND не доказан. Bridge не изменён.


11.10.2026; bugfix/139, baseline cd38cb745759becd58dbbad4d6d37afa03f0ab7a, worktree D:/Projects/pero_crm_worktrees/improvements-139. Planning baseline до Root RELEASE: appsource/dependencies/lockfile/DB/S3/Next/runtime/RSS изменены или запущены **0**. Current implementation ниже.

AGENTS/README/plan139+preservation+140/151 boundaries/SAFETY-RULES прочитаны. Root nearest OpenSpec подтверждён context/list; config spec-driven, RU artifacts. Inventory5 main specs, engineer file/task/role requirements и mobile/photo workflow прочитаны; existing upload/receipt/target/middleware/caller files исследованы.

Наблюдаемое: all supported ordinary UI callsites transit central sendFileUpload; builders file-first. Bot only finance path140, ordinary v1/SDK upload не найден. readUploadReceipt fingerprint actor/nonce/target/bytes existing; publication после s3Put ACK. Middleware exactupload exclusion сохраняется. Parser отсутствует в public lockfile; busboy1.6.0 proposed direct dep, пока не installed. Current pinned AWS SDK3.1123.0, Next15.5.20, Prisma6.19.3 безизменений.

Root явное qualification по requirement сохранить функциональность: legacy headerless/file-first bounded private spool остаётся; auth/global upload role beforebody, exact entityACL когда complete metadata доступны и передstorage/finalize. Declared headerlane даёт entityACL0body и latebinding. Нельзя утверждать zero legacy bytes before exactACL. Проектные роли/CAS/receipt/keys/data не меняются.

Primary docs: pinned BusboyREADME public bounds/truncation/UTF8 parameters; Node22pipeline/fromWeb/abort/HWM threshold; AWSprecomputed SHA checksums. Firecrawldeveloperindex дал первичные источники; scrape упёрся вcredits, официальныйwebfallback прочитан. CompatibilityMinIO/retry/RSS/realHTTP ещё NOT_RUN, не deducedPASS издокументации.

Proposal/spec/design/tasks готовы для независимого review; proposed exactsource allowlist/limits/defaults/dependency gate и required local/native/stage matrices вdesign. No new schema/migration. No WIP135 copy;139 branch отacceptedcd38. Remaining DESIGN_GO/RELEASE/code/local/native/RSS/staging всёNOT_RUN; commitsHOLD, main/prod/infra/restic forbidden.
## Independent design review corrections

Reviewer P2 findings приняты до implementation: advertised configurable header-pairs64/fieldName100 нельзя вывести из Busboy multipart1.6.0; source hardcodes header16 КиБ/MAX_HEADER_PAIRS2000 и игнорирует эти options. Design теперь явно отличает fixed parser bounds от own UTF8 field-name/count checks и coarse+1 limits, с inclusive4096 field/17parts regression criteria. Shadow header parser не вводится.

Retry requirement согласован с actual route: конкурентные запросы могут Put distinct fresh objects до atomic nonce dedup; результат один File/receipt/notification и known loser compensation без retained extra owned object. Единственный physical storage effect не обещается; unknown cleanup остаётся unknown.

Exact proposed dependencies busboy1.6.0/@types/busboy1.5.4. Published npm primary page подтверждает types version/dependency @types/node; locked Node types не обновлять. Registry direct read-only metadata probe в default sandbox завершился TLS authentication failure, без результата/сохранения/install; этот probe не повторялся. Official web primary fallback прочитан. No dependencies/appsource/runtime/DB/storage effects.
## Implementation local packet (after Root RELEASE)

Root RELEASE139/dependency GO и independent corrected DESIGN_GO получены. Own install: offline NO_OFFLINE_META, затем normal prefer-offline exit0. ACTUAL_DEPENDENCY_DIFF_GO: только busboy1.6.0/devtypes1.5.4/streamsearch1.1.0; locked Node types20.19.43 и прежние versions unchanged. Static Prisma generate6.19.3 PASS, schema/DB untouched.

RED до meaningful source: client+actualhandler8PASS/3FAIL (missingheader/declaredforeign bodypull2/malformed404 вместо400). Parser missing-module RED. Дополнительный actualdocument RED с forbidden formData/arrayBuffer: old400 вместоstorageboundary500; после spool/stream GREEN. Это real Request/handler/transport, не native DB/S3.

Current code: neutral header; reuse target adapter; bounded multipart/private owned spool+streamhash; S3 known length/SHA/maxattempt1; local guarded no-clobber; route early/late binding/fresh auth/final permissions; image-only bounded Buffer/original bytes/unknown ACK retention. UI/CSS/schema/migration/finance/logistics/bot/135 не менялись.

Root added shared tests/helpers/multipart-request.ts: lazy real File.stream/bodypull/cancel, no import IO. Contract status/ACL/CAS/receipt/audit/old+winner-key assertions сохранены. Только implementation-only fullbuffer1→fullbuffer0+streamedbytes/hash. Known fixture truthful service4xx/attempt1; generic unknown отдельно. Diagnostic expected STORAGE_ACCESS_DENIED соответствует новому input AccessDenied и existing code map, не weakened generic failure.

Coupled first29PASS/3FAIL выявил asyncfinally rejection gap: обе committedSketchReply ветки теперь return await перед dispose. Global fake actor race исправлен AsyncLocalStorage perrequest, production identity guard сохранён. Rerun пяти existing suites **32/32 PASS**, original concurrent200/200 и200/409/cleanup503/replay/audit/bytes/pointers/keys.

Latest три новые suites **18/18 PASS**: actualdoc/header0body/malformed/latebinding/currentrole-session-entity revoke, realBusboy split/Unicode/hash/inclusivecaps/parts/extrafile/duplicatefield/abort/sourcecancel/exactprivatecleanup/16KiBoverflow/invalidconstructor/emptydoc/name100, mockSDK length/SHA/maxattempt1/unknownnoreplay. Existing client **8/8 PASS**. Изолированные commands, fullsuite/CI не запускался.

Scoped ESLint14 paths **PASS0errors/0warnings**. First tsc69652 FAIL2: overloaded auth ReturnType NextMiddleware + abortfixture ArrayBufferLike. Canonical CoverMutationActor и exact ArrayBuffer fixes; approved rerun **fullweb noEmit/incrementalfalse PASS session56915 exit0/no output**. Slot released to root/132. Runtime auth predicates unchanged.

Actual HTTP/socket behavior/large RSS/local fallback FS/PostgreSQL/native/real MinIO-S3/browser/staging **NOT_RUN**. Tiny owned unittemp created/cleaned, actual CRM/storage/network effects0. Main/prod/infra/restic/dump/seed/reset/newDB untouched; NEW commits HOLD. RSS source/protocol review-only, no child/server/large load started.

## Compatibility correction: delayed public file event

Reviewer MIME P2 подтвердился pure native vsBusboy (params/last duplicate/type/name/base64 decoded contract); LOCAL_SOURCE_READY отозван, исходники не исправлялись до нового design GO. Первый framing probe показал задержку streamsearch: chunks1 file event start262/end263 при headerEnd262, currentCutfalse; chunks64 eventend271/currentCuttrue уже у payload blankline. Первоначальный current-cut binding явно HOLD/superseded, не accepted proof.

Revised pure retained candidate +finite one-byte lookahead<=boundary+4, public write ACK, no private fields, native EMPTY bounded metadata sidecar. Actual output:

```json
{"comparisons":1467,"differences":0,"peakRetainedBytes":267,"firstErrors":[]}
```

Memory-only synthetic forms <1KiB, widths1/2/3/4/7/16/64/1024 +all two-chunk split offsets, earlier text blanklines/almost-boundaries/payload blanklines, params/lastduplicate/emptytype/defaulttype/foldername/base64metadata. Первоначальная версия almost-boundary содержала полный delimiter prefix и была отвергнута native baseline; это не differential failure. Synthetic string исправлена на несовпадающий marker, результат выше. Source, FS, DB, HTTP, S3, Next, largeRSS0 в этих probes. Quiet141 window новые Node/checks не запускаются.

Exact completed pure probe code (review-only; НЕ implementation):

```javascript

const busboy=require('busboy');
const D=Buffer.from('\r\n\r\n'),B='b139-public';
function form(header,payload='payload\r\n\r\ntext',before=''){return Buffer.from((before?'--'+B+'\r\nContent-Disposition: form-data; name="note"\r\n\r\n'+before+'\r\n':'')+'--'+B+'\r\n'+header+'\r\n\r\n'+payload+'\r\n--'+B+'--\r\n');}
async function candidate(body,width,forcedSplit){
 const parser=busboy({headers:{'content-type':'multipart/form-data; boundary='+B},defParamCharset:'utf8',preservePath:true});
 let ring=Buffer.alloc(0),pending=Buffer.alloc(0),snap=null,budget=0,offset=0,seen=false,event,peak=0,probes=0;
 const ringBound=16384+Buffer.byteLength(B)+8;
 parser.on('file',(name,stream,info)=>{event={name,info,header:snap&&snap.header,offset,snapshotEnd:snap&&snap.end};seen=true;stream.resume();});parser.on('field',()=>{});parser.on('error',()=>{});
 const write=async segment=>{
  offset+=segment.length;
  if(!seen){ring=Buffer.from(Buffer.concat([ring,segment]).subarray(-ringBound));peak=Math.max(peak,ring.length);
   if(ring.subarray(-4).equals(D)){const marker=Buffer.from('\r\n--'+B+'\r\n');let at=ring.lastIndexOf(marker),headStart=at<0?-1:at+marker.length;
    if(headStart<0&&offset===ring.length&&ring.subarray(0,B.length+4).equals(Buffer.from('--'+B+'\r\n')))headStart=B.length+4;
    snap={header:headStart>=0?Buffer.from(ring.subarray(headStart,ring.length-4)):null,end:offset};budget=B.length+4;
   }else if(budget>0){budget--;probes++;}
  }
  await new Promise((resolve,reject)=>parser.write(segment,error=>error?reject(error):resolve()));
 };
 const pump=async final=>{while(pending.length){let take;
   if(seen)take=pending.length;else if(budget>0)take=1;
   else{const cut=pending.indexOf(D);if(cut>=0)take=cut+4;else{if(!final&&pending.length<=3)break;take=final?pending.length:pending.length-3;}}
   const piece=pending.subarray(0,take);pending=pending.subarray(take);await write(piece);
 }};
 const chunks=forcedSplit===undefined?Array.from({length:Math.ceil(body.length/width)},(_,i)=>body.subarray(i*width,(i+1)*width)):[body.subarray(0,forcedSplit),body.subarray(forcedSplit)];
 for(const chunk of chunks){pending=Buffer.concat([pending,chunk]);await pump(false);}await pump(true);
 await new Promise((resolve,reject)=>{parser.once('finish',resolve);parser.once('error',reject);parser.end();});
 if(!event||!event.header)throw Error('NO_EXACT_HEADER');
 const sidecar=Buffer.concat([Buffer.from('--'+B+'\r\n'),event.header,Buffer.from('\r\n\r\n\r\n--'+B+'--\r\n')]);
 const fields=await new Request('https://unit.invalid',{method:'POST',headers:{'content-type':'multipart/form-data; boundary='+B},body:sidecar}).formData();
 const entry=[...fields][0];
 return {name:entry&&entry[0],file:entry&&entry[1],peak,probes,header:event.header.toString(),eventOffset:event.offset,headerEnd:event.snapshotEnd};
}
async function baseline(body){const fields=await new Request('https://unit.invalid',{method:'POST',headers:{'content-type':'multipart/form-data; boundary='+B},body}).formData();return fields.get('file');}
(async()=>{
 const headers=[
 'Content-Disposition: form-data; name="file"; filename="folder/чертёж.txt"\r\nContent-Type: Text/Plain; charset=windows-1251',
 'Content-Disposition: form-data; name="file"; filename="qa.pdf"\r\nContent-Type: text/plain\r\nContent-Type: APPLICATION/PDF; x-test=abc',
 'Content-Disposition: form-data; name="file"; filename="qa.dat"\r\nContent-Type:',
 'Content-Disposition: form-data; name="file"; filename="qa.dat"',
 'Content-Disposition: form-data; name="file"; filename="qa.dat"\r\nContent-Transfer-Encoding: base64\r\nContent-Type: application/octet-stream'];
 let comparisons=0,peak=0,errors=[];
 for(const [i,header]of headers.entries()){
  const body=form(header,i===4?'SGVsbG8=\r\n':'\r\n\r\npayload\r\n\r\n--b139-publiX-near\r\n\r\n','earlier\r\n\r\n--b139-publiX-near\r\nX: fake\r\n\r\ntext');
  let old;try{old=await baseline(body);}catch(e){throw Error('BASELINE_CASE_'+i+'_'+e.name);}
  for(const width of[1,2,3,4,7,16,64,1024]){let got;try{got=await candidate(body,width);}catch(e){throw Error('CANDIDATE_CASE_'+i+'_WIDTH_'+width+'_'+e.message);}
   comparisons++;peak=Math.max(peak,got.peak);if(got.name!=='file'||got.file.name!==old.name||got.file.type!==old.type||got.header!==header)errors.push({i,width,oldName:old.name,newName:got.file.name,oldType:old.type,newType:got.file.type,headerMatch:got.header===header});}
  for(let split=1;split<body.length;split++){let got;try{got=await candidate(body,0,split);}catch(e){throw Error('CANDIDATE_CASE_'+i+'_SPLIT_'+split+'_'+e.message);}
   comparisons++;peak=Math.max(peak,got.peak);if(got.name!=='file'||got.file.name!==old.name||got.file.type!==old.type||got.header!==header)errors.push({i,split,headerMatch:got.header===header});}
 }
 process.stdout.write(JSON.stringify({comparisons,differences:errors.length,peakRetainedBytes:peak,firstErrors:errors.slice(0,3)}));
})().catch(error=>{process.stdout.write(JSON.stringify({error:error.name,message:error.message}));process.exitCode=1});
```

## Latest compatibility code / local proof

Root/reviewer retainedcandidate/quote-native API RELEASE получены. Meaningful compatibility RED26PASS/5FAIL: basename loss/full MIME lost/base64raw cap/noEMPTY sidecar/oldreceipt409. Затем31GREEN иdeterministic130 native differential variants, low8 Unicode/invalidUTF8/duplicate transfer encoding/native finalquantum+standard76CRLF at mocked decoded cap. Browser%22 quote отдельныйactualRED400; refined exactly1 disposition/native public-field match/authoritative nativeName →GREEN.

Latest targeted affected9 suites **66/66 PASS**, original statuses/CAS/concurrent200200/200409/audit/unknown ACK/old+winners keys/bytes сохранились; new oldreceipt params/folder/quote/base64 returns200/oldID/repeated with0Put/notify/commit. Near16KiB/suffix splitting/earliertextblankline/payloadblankline/EMPTYsidecar/abortduringmetadata/exactowncleanup PASS. Full original request formData nevercalled; sidecar actualnativeFile.size0 proof.

Latest scoped ESLint3 **PASS0errors0warnings**. EarlierTSC11940 FAIL1 only testOracle Buffer<ArrayBufferLike> BodyInit; bounded Uint8Array copy →parser12PASS/lintPASS +TSC68583PASS. That fullTSC covers pre-quote source; latest source requires separately coordinated finaltyping, **NOT_RUN** until actual command. 300f/a160 review snapshots superseded, current manifest recalculated after codefreeze. ActualHTTP/RSS/localpublishFS/MinIO/DB/visual/stage **NOT_RUN**. Human wholeplancommit grant полученroot; finalreview/localruntime/root integration signal required, main/prod prohibited.

## Frozen source review request139

Latest final fullweb tsc **PASS session38308 exit0/nooutput** на quote/native/metadataabort source, sourcefreeze maintained. Strict OpenSpecPASS/latestscopedlint0/0/affected66PASS/diffcheckPASS; current stagedempty/24relatedpaths, exact package/lock additions independentGO unchanged. Review-only ordered17 manifest hash **6546d0a8967a5de45b2a213a12dc80513c08691aafe5547e2cd84d1f107b1eb3**; это local physical review point, не full transitiveruntime/staging closure. Previous a160/300f SUPERSEDED.

```json
{
  "reviewOnlyCandidateHash": "6546d0a8967a5de45b2a213a12dc80513c08691aafe5547e2cd84d1f107b1eb3",
  "manifest": [
    {
      "path": "apps/web/package.json",
      "sha256": "32928206a98a618b3065b7dddd7982816f4443d1febee758b7a2bd8d4a02b63c"
    },
    {
      "path": "pnpm-lock.yaml",
      "sha256": "b0ec0dfffe8d51163eec6691f283eb7d4c06ac871bae4c1c3b77c2f2f537fdab"
    },
    {
      "path": "apps/web/prisma/schema.prisma",
      "sha256": "0db52a715efadccabcfd45ef69c246bcb27dc4297ff38f9a4a45c9daefbb4aae"
    },
    {
      "path": "apps/web/src/app/api/files/upload/route.ts",
      "sha256": "16364af9b07bd29ae2cc365de193872b0c67b27855c6b6b9ae563783f257645c"
    },
    {
      "path": "apps/web/src/lib/file-upload-client.ts",
      "sha256": "039165b05fd8351422ecdfb7a1674fbbc51bc51f02cf76bbb552d2329e7985fb"
    },
    {
      "path": "apps/web/src/lib/upload-request-context.ts",
      "sha256": "81455e4c022c3829d343b95b1883ce03ba2eb6ed7b26bbb435002755dee61dd2"
    },
    {
      "path": "apps/web/src/lib/s3.ts",
      "sha256": "3fbec72a9873d6b314bdfa0d9fc7965bff9270529e369fdf80d9db25475dfde1"
    },
    {
      "path": "apps/web/src/server/files/upload-target.ts",
      "sha256": "59b4de197bb5f8ee5e4061c985df8665bd31e4c2498b787fde623559c77c6ee8"
    },
    {
      "path": "apps/web/src/server/files/multipart-upload.ts",
      "sha256": "cd8432bd71658aa5b08c755847edde7e28ead7e0ebb7dbc84f730402c1c22080"
    },
    {
      "path": "apps/web/src/server/files/upload-storage.ts",
      "sha256": "8317ee458c9f14c083b09d9f60716d10f2fb6c43a83909b4c379a667ded40a37"
    },
    {
      "path": "apps/web/tests/file-upload-client.test.ts",
      "sha256": "530c69366b1021f089a9b2d47fdaadd5bcc565f1206e468f251b50804da114ba"
    },
    {
      "path": "apps/web/tests/file-upload-transport-handler.test.ts",
      "sha256": "b3e5dce3da7eefffc9a641608ebaed6ab1e748f810d8a955eb4cc093e422c910"
    },
    {
      "path": "apps/web/tests/multipart-upload.test.ts",
      "sha256": "7cafb85b4ee874910d4bbdf59b95ba98c5811305606dc4852f37fb2aba3f5453"
    },
    {
      "path": "apps/web/tests/s3-upload-reliability.test.ts",
      "sha256": "ae09a604c6752641b99c87fee83236891af00fdd46b5223df4d16986adf7adc1"
    },
    {
      "path": "apps/web/tests/product-attachments-upload-stage.test.ts",
      "sha256": "7cac24cf5f1d877dc3991ebfff4e044cbf802b2a465f4f794d0085670605dd7d"
    },
    {
      "path": "apps/web/tests/upload-route-reliability.test.ts",
      "sha256": "28328a739d1a96502c0721b2798714a5f680938ab28a36dc4b613674504ceaa5"
    },
    {
      "path": "apps/web/tests/helpers/multipart-request.ts",
      "sha256": "57ef7cc0be2ead9f1c08135b81144a2dec60811658f4bacfc123e2f4ad4792fa"
    }
  ]
}
```

Remaining: independent SOURCE_CODE review, inert RSS supportingentry/codepins/cold-import controls затем отдельныйROOT resource+executeGO. Actual source HTTP/RSS/localfallbackFS/MinIO/PostgreSQL/nativevisual/stage **NOT_RUN**. Former RSS design вdesign.md, пределы32/64MiB fixed; dummySDK/publisher proof неMinIO. До stage candidate source guard полныйmetafile/entry/deps/schema/runtime долженбытьsealed отдельно.

## CURRENT SOURCE_PREPARE139 review packet (supersedes6546)

Reviewer quoted-boundary P2 actualRED1FAIL→originalvalidatedContent-Type toEMPTYsidecar→latest affected9suites **67/67PASS**, scopedchanged2lint0/0. Punctuation4quotedboundary×6chunkwidths/name/fullMIME/hash/bytes/cleanupPASS. Noauth/storage/name/decodepolicy weakening.

RSSentry SOURCE_PREPARE created/inert, protocol/matrix indesign. Coldimport latest **PASS** newpublicTCP/Process resources[], mainfalse; lint0/0. Entry initialTSC69483 FAIL2 canonicalNextRequestinit/processenv; reviewedfixes +fixedbaseline/percasepeakscope (baselineunchanged/32-64 unchanged) →**finalfullwebTSC24859 exit0PASS/nooutput**. Этоstrictsourcecheck, неCI/native/runtime PASS.

Current ordered18 review-only physicalmanifest hash **d1b5b1859a32a1ba6c5f2ea08e229c839628f59aef9077b7c473621aeaf1ffc4** (includesRSSentry). Fulltransitiveruntime/metafileclosure+operatorapproval stillrequired beforeRUN; belowmanifest не заменяетclosure. Entryphysicalc745bcbf…; multipart610b6252…; package/lock/schema unchanged.

```json
{
  "reviewOnlyCandidateHash": "d1b5b1859a32a1ba6c5f2ea08e229c839628f59aef9077b7c473621aeaf1ffc4",
  "manifest": [
    {
      "path": "apps/web/package.json",
      "sha256": "32928206a98a618b3065b7dddd7982816f4443d1febee758b7a2bd8d4a02b63c"
    },
    {
      "path": "pnpm-lock.yaml",
      "sha256": "b0ec0dfffe8d51163eec6691f283eb7d4c06ac871bae4c1c3b77c2f2f537fdab"
    },
    {
      "path": "apps/web/prisma/schema.prisma",
      "sha256": "0db52a715efadccabcfd45ef69c246bcb27dc4297ff38f9a4a45c9daefbb4aae"
    },
    {
      "path": "apps/web/src/app/api/files/upload/route.ts",
      "sha256": "16364af9b07bd29ae2cc365de193872b0c67b27855c6b6b9ae563783f257645c"
    },
    {
      "path": "apps/web/src/lib/file-upload-client.ts",
      "sha256": "039165b05fd8351422ecdfb7a1674fbbc51bc51f02cf76bbb552d2329e7985fb"
    },
    {
      "path": "apps/web/src/lib/upload-request-context.ts",
      "sha256": "81455e4c022c3829d343b95b1883ce03ba2eb6ed7b26bbb435002755dee61dd2"
    },
    {
      "path": "apps/web/src/lib/s3.ts",
      "sha256": "3fbec72a9873d6b314bdfa0d9fc7965bff9270529e369fdf80d9db25475dfde1"
    },
    {
      "path": "apps/web/src/server/files/upload-target.ts",
      "sha256": "59b4de197bb5f8ee5e4061c985df8665bd31e4c2498b787fde623559c77c6ee8"
    },
    {
      "path": "apps/web/src/server/files/multipart-upload.ts",
      "sha256": "610b6252bc3e410caed5664d7a929731c022f7d4780cd70963e5514656138d0d"
    },
    {
      "path": "apps/web/src/server/files/upload-storage.ts",
      "sha256": "8317ee458c9f14c083b09d9f60716d10f2fb6c43a83909b4c379a667ded40a37"
    },
    {
      "path": "apps/web/tests/file-upload-client.test.ts",
      "sha256": "530c69366b1021f089a9b2d47fdaadd5bcc565f1206e468f251b50804da114ba"
    },
    {
      "path": "apps/web/tests/file-upload-transport-handler.test.ts",
      "sha256": "b3e5dce3da7eefffc9a641608ebaed6ab1e748f810d8a955eb4cc093e422c910"
    },
    {
      "path": "apps/web/tests/multipart-upload.test.ts",
      "sha256": "66a598d996e12f2f5f55555f3c0eaee63d0f15b6eac80f7fe13dcb1d6a91f506"
    },
    {
      "path": "apps/web/tests/s3-upload-reliability.test.ts",
      "sha256": "ae09a604c6752641b99c87fee83236891af00fdd46b5223df4d16986adf7adc1"
    },
    {
      "path": "apps/web/tests/product-attachments-upload-stage.test.ts",
      "sha256": "7cac24cf5f1d877dc3991ebfff4e044cbf802b2a465f4f794d0085670605dd7d"
    },
    {
      "path": "apps/web/tests/upload-route-reliability.test.ts",
      "sha256": "28328a739d1a96502c0721b2798714a5f680938ab28a36dc4b613674504ceaa5"
    },
    {
      "path": "apps/web/tests/helpers/multipart-request.ts",
      "sha256": "57ef7cc0be2ead9f1c08135b81144a2dec60811658f4bacfc123e2f4ad4792fa"
    },
    {
      "path": "apps/web/tests/file-upload-transport-rss.ts",
      "sha256": "c745bcbfc0ab64a8a726687bb0efac6fd768bd274ac6296f9364b6f8a36e68c8"
    }
  ]
}
```

ActualHTTP/childreceiver/largeIO/RSS/minio/localpublishFS/native/browser/stage **NOT_RUN**. RSS SDKmock only consumesstream+length/checksum; noMinIOproof. ReviewerSOURCE_CODE+RSSSOURCE_PROTOCOL gates thenROOTquiet resource approval required. 135localcommit6077cc9 deliveredroot, no main/prod/push/flags.

## CURRENT RSS P2 lifecycle source packet

Previous ordered18 d1b5/c745 snapshot above is historical; production139/old regression member bytes unchanged. Current candidate adds one root-approved cold suite plus readonly Next config/Dockerfile context pins. This ordered21 review-only manifest is NOT full transitive/metafile runtime closure.

Independent RSS P2 fixed in entry: bounded30s in-flight/admission drain includes async spool.dispose; no new admit while draining, capture baseline only inside drained callback, admissions0/active0/errors[] required. The same barrier protects case-start/snapshot/shutdown. Dispose failure, falsy rejection, hung handler and pending admission stop capture. Fixed warm baseline and32/64MiB gates unchanged.

Spawn-owned handle/PID/run/token capability exists before hello; early exit/error listeners are registered immediately. STOP sends SIGTERM only to that exact handle, waits up to10s, and records real exit code/signal/kill ACK or retained/HOLD. Success also requires bounded known exit code0. Unknown retains PRE/spool; no arbitrary PID lookup, broad kill or cleanup. Token/raw error/secret are not reported.

Cold suite RED671c2a exit1/0PASS13FAIL (new control exports absent), then GREEN0feb7e and latest55415a exit0/13PASS0FAIL. This controlled Promise/EventEmitter evidence covers response-before-dispose, delayed admission, cleanup failure, falsy rejection, deadline, exit confirmation, timeout-before-hello, kill false/throw, PID substitution, early exit and spawn error. No actual child/HTTP/storage lifecycle claim.

Commands: pnpm --filter @pero/web exec tsx --test tests/file-upload-transport-rss.test.ts; pnpm --filter @pero/web exec eslint tests/file-upload-transport-rss.ts tests/file-upload-transport-rss.test.ts (2f7128 exit0,0errors/0warnings); pnpm --filter @pero/web exec tsc --noEmit --incremental false (session96805 exit0,no output). Current cold import be2483 PASS, mainInvokedfalse,newTcpOrProcessResources[].

Common163 current helper33c0a02f is not imported by this entry. Exact apps/web/next.config.ts and apps/web/Dockerfile are now required runtime closure members. Full runtime inputs/metafile/source seals/operator approval are still required before RUN; these21 hashes do not assert completeness. Actual HTTP/childreceiver/largeIO/RSS/MinIO/localpublishFS/native/browser/staging NOT_RUN; no DB/S3/config/flag changes.

```json
{
  "reviewOnlyCandidateHash": "cc77c04c13bad796dfa37b421b5a793d06c598a55737227bc961e84902e904b6",
  "manifest": [
    {
      "path": "apps/web/package.json",
      "sha256": "32928206a98a618b3065b7dddd7982816f4443d1febee758b7a2bd8d4a02b63c"
    },
    {
      "path": "pnpm-lock.yaml",
      "sha256": "b0ec0dfffe8d51163eec6691f283eb7d4c06ac871bae4c1c3b77c2f2f537fdab"
    },
    {
      "path": "apps/web/prisma/schema.prisma",
      "sha256": "0db52a715efadccabcfd45ef69c246bcb27dc4297ff38f9a4a45c9daefbb4aae"
    },
    {
      "path": "apps/web/src/app/api/files/upload/route.ts",
      "sha256": "16364af9b07bd29ae2cc365de193872b0c67b27855c6b6b9ae563783f257645c"
    },
    {
      "path": "apps/web/src/lib/file-upload-client.ts",
      "sha256": "039165b05fd8351422ecdfb7a1674fbbc51bc51f02cf76bbb552d2329e7985fb"
    },
    {
      "path": "apps/web/src/lib/upload-request-context.ts",
      "sha256": "81455e4c022c3829d343b95b1883ce03ba2eb6ed7b26bbb435002755dee61dd2"
    },
    {
      "path": "apps/web/src/lib/s3.ts",
      "sha256": "3fbec72a9873d6b314bdfa0d9fc7965bff9270529e369fdf80d9db25475dfde1"
    },
    {
      "path": "apps/web/src/server/files/upload-target.ts",
      "sha256": "59b4de197bb5f8ee5e4061c985df8665bd31e4c2498b787fde623559c77c6ee8"
    },
    {
      "path": "apps/web/src/server/files/multipart-upload.ts",
      "sha256": "610b6252bc3e410caed5664d7a929731c022f7d4780cd70963e5514656138d0d"
    },
    {
      "path": "apps/web/src/server/files/upload-storage.ts",
      "sha256": "8317ee458c9f14c083b09d9f60716d10f2fb6c43a83909b4c379a667ded40a37"
    },
    {
      "path": "apps/web/tests/file-upload-client.test.ts",
      "sha256": "530c69366b1021f089a9b2d47fdaadd5bcc565f1206e468f251b50804da114ba"
    },
    {
      "path": "apps/web/tests/file-upload-transport-handler.test.ts",
      "sha256": "b3e5dce3da7eefffc9a641608ebaed6ab1e748f810d8a955eb4cc093e422c910"
    },
    {
      "path": "apps/web/tests/multipart-upload.test.ts",
      "sha256": "66a598d996e12f2f5f55555f3c0eaee63d0f15b6eac80f7fe13dcb1d6a91f506"
    },
    {
      "path": "apps/web/tests/s3-upload-reliability.test.ts",
      "sha256": "ae09a604c6752641b99c87fee83236891af00fdd46b5223df4d16986adf7adc1"
    },
    {
      "path": "apps/web/tests/product-attachments-upload-stage.test.ts",
      "sha256": "7cac24cf5f1d877dc3991ebfff4e044cbf802b2a465f4f794d0085670605dd7d"
    },
    {
      "path": "apps/web/tests/upload-route-reliability.test.ts",
      "sha256": "28328a739d1a96502c0721b2798714a5f680938ab28a36dc4b613674504ceaa5"
    },
    {
      "path": "apps/web/tests/helpers/multipart-request.ts",
      "sha256": "57ef7cc0be2ead9f1c08135b81144a2dec60811658f4bacfc123e2f4ad4792fa"
    },
    {
      "path": "apps/web/tests/file-upload-transport-rss.ts",
      "sha256": "306b4c9098700d1fe30d18acc377ac0945bbef6008f777a6435bbd7eaf0bc7f7"
    },
    {
      "path": "apps/web/tests/file-upload-transport-rss.test.ts",
      "sha256": "87fbbdbbd9086747763684a4ba938a4a8f9adef5c0db1ef6a276353adcf9603a"
    },
    {
      "path": "apps/web/next.config.ts",
      "sha256": "f0ae3b9476607d09d15fe399cf31a7d6d36e103f15c149490026a70cc2a42ddf"
    },
    {
      "path": "apps/web/Dockerfile",
      "sha256": "b416f3b48782b6a578af0c6df06a004413505541e7047b99e4a6686c5c1375f3"
    }
  ]
}
```

## CURRENT QA-only SDK descriptor correction packet

306b/690 and their prepared/source-only receipts remain historical above, never executed. Production139 and other old regression pins unchanged. Installed S3Client3.1123.0 source class4881 confirms inherited send; prior own descriptor undefined caused shutdown defineProperty failure. Root narrow QA_ONLY_DESCRIPTOR_FIX_GO permits checked own override restore (inherited→deleteonlyours; own→exact descriptor; foreign→STOP), then all server/sdk/spool/source cleanup steps attempted with ordered sanitized primary/falsy/secondary failures.

New cold suite RED23cd1e 13PASS4FAIL →GREEN5da18717PASS0FAIL, scopedlint8fe7eb0errors0warnings. No SDK/app/worker evaluation or runtime sourcebuild. Relevant latesttyping pending separate root slot. Historical fullTSC96805/24859 remain prior-source facts.

New private producer pin1fdbcf9d0389c68aaac6222bf8c68b11c9393e91eaaf6c3c66ff7d8d4eec2d2f updates only exact entry/21 expected constants; public source protocol/API unchanged. Its earlier AST/cold/protocol690 source-only evidence does not assert current compiler build. Full transitive/metafile/real link observations stillNOT_RUN.

```json
{
  "reviewOnlyCandidateHash": "445eeca6df106fa4aeff41f1584cc709efc0c36c28e3d19f9b8f94b6443e1671",
  "manifest": [
    {
      "path": "apps/web/package.json",
      "sha256": "32928206a98a618b3065b7dddd7982816f4443d1febee758b7a2bd8d4a02b63c"
    },
    {
      "path": "pnpm-lock.yaml",
      "sha256": "b0ec0dfffe8d51163eec6691f283eb7d4c06ac871bae4c1c3b77c2f2f537fdab"
    },
    {
      "path": "apps/web/prisma/schema.prisma",
      "sha256": "0db52a715efadccabcfd45ef69c246bcb27dc4297ff38f9a4a45c9daefbb4aae"
    },
    {
      "path": "apps/web/src/app/api/files/upload/route.ts",
      "sha256": "16364af9b07bd29ae2cc365de193872b0c67b27855c6b6b9ae563783f257645c"
    },
    {
      "path": "apps/web/src/lib/file-upload-client.ts",
      "sha256": "039165b05fd8351422ecdfb7a1674fbbc51bc51f02cf76bbb552d2329e7985fb"
    },
    {
      "path": "apps/web/src/lib/upload-request-context.ts",
      "sha256": "81455e4c022c3829d343b95b1883ce03ba2eb6ed7b26bbb435002755dee61dd2"
    },
    {
      "path": "apps/web/src/lib/s3.ts",
      "sha256": "3fbec72a9873d6b314bdfa0d9fc7965bff9270529e369fdf80d9db25475dfde1"
    },
    {
      "path": "apps/web/src/server/files/upload-target.ts",
      "sha256": "59b4de197bb5f8ee5e4061c985df8665bd31e4c2498b787fde623559c77c6ee8"
    },
    {
      "path": "apps/web/src/server/files/multipart-upload.ts",
      "sha256": "610b6252bc3e410caed5664d7a929731c022f7d4780cd70963e5514656138d0d"
    },
    {
      "path": "apps/web/src/server/files/upload-storage.ts",
      "sha256": "8317ee458c9f14c083b09d9f60716d10f2fb6c43a83909b4c379a667ded40a37"
    },
    {
      "path": "apps/web/tests/file-upload-client.test.ts",
      "sha256": "530c69366b1021f089a9b2d47fdaadd5bcc565f1206e468f251b50804da114ba"
    },
    {
      "path": "apps/web/tests/file-upload-transport-handler.test.ts",
      "sha256": "b3e5dce3da7eefffc9a641608ebaed6ab1e748f810d8a955eb4cc093e422c910"
    },
    {
      "path": "apps/web/tests/multipart-upload.test.ts",
      "sha256": "66a598d996e12f2f5f55555f3c0eaee63d0f15b6eac80f7fe13dcb1d6a91f506"
    },
    {
      "path": "apps/web/tests/s3-upload-reliability.test.ts",
      "sha256": "ae09a604c6752641b99c87fee83236891af00fdd46b5223df4d16986adf7adc1"
    },
    {
      "path": "apps/web/tests/product-attachments-upload-stage.test.ts",
      "sha256": "7cac24cf5f1d877dc3991ebfff4e044cbf802b2a465f4f794d0085670605dd7d"
    },
    {
      "path": "apps/web/tests/upload-route-reliability.test.ts",
      "sha256": "28328a739d1a96502c0721b2798714a5f680938ab28a36dc4b613674504ceaa5"
    },
    {
      "path": "apps/web/tests/helpers/multipart-request.ts",
      "sha256": "57ef7cc0be2ead9f1c08135b81144a2dec60811658f4bacfc123e2f4ad4792fa"
    },
    {
      "path": "apps/web/tests/file-upload-transport-rss.ts",
      "sha256": "d1b8aa9750f3efb33ad4bc0de4fdfb17b27eaf71072b953dddabd4915261478d"
    },
    {
      "path": "apps/web/tests/file-upload-transport-rss.test.ts",
      "sha256": "9153423d5f679f89ad8107ca4a843f2c66138cb78cc1d9263849417b8cd30427"
    },
    {
      "path": "apps/web/next.config.ts",
      "sha256": "f0ae3b9476607d09d15fe399cf31a7d6d36e103f15c149490026a70cc2a42ddf"
    },
    {
      "path": "apps/web/Dockerfile",
      "sha256": "b416f3b48782b6a578af0c6df06a004413505541e7047b99e4a6686c5c1375f3"
    }
  ]
}
```

Latest relevant fullweb TSC72339 completed exit0/PASS/nooutput (d101e2), source d1b8/21 445e/producer1fdb unchanged during typing. Root slot released. This is strict source verification, not CI/native/sourcebuild/RSS/HTTP/MinIO/staging acceptance.

## CURRENT bounded HTTP matrix deadline packet

Root/reviewerP2 unbounded HTTP fixed in QA-only entry: overallwarmups+matrix monotonic600000ms (approved10min), everyadmission/baseline/case/snapshot/send gets remainingbudget. Per-send AbortController covers request/response/write wait; peer aborts and await boundedowned-lifecycle joins beforePIDtermination. Close/no-end/error/abort/dataoverflow settle waiters/removehandlers; lateownresponse/error observesuntilclose, noremoteapp eval. Memory32/64MiB/baseline/cases/production unchanged.

ColdRED739c2f17PASS6FAIL→GREEN9e68a423PASS plusmeaningful peer/admission/hungjoin/pre-aborted controls→latestbcf7b027PASS0FAIL. Scopedlintda9a960/0, fullweb3049exit0PASSa24d9c. Currentignoredproducer changesonly2EXPECTEDconstants versusreviewed5cc; source/noeffectcollector caps remainunchanged. Sourcewindow/Node guards unchanged.

Earlieractual82359/71f/a446/d461/12666files/54families/218links remain accepted historicalSOURCEonly for d1b8, nevermutated or reusedfornewentry. FreshUUID sourceclosure aftercurrentdelta review/rootonebuild stillNOT_RUN; runtimeproposed4ef staysNOT_RUN pendingthatactualclosure. Production oldmemberhashes identical.

```json
{
  "reviewOnlyCandidateHash": "3b3dcbc620477c27296c8c9813154e0a20c6f7dfd3c2ba424109de89afd635c5",
  "manifest": [
    {
      "path": "apps/web/package.json",
      "sha256": "32928206a98a618b3065b7dddd7982816f4443d1febee758b7a2bd8d4a02b63c"
    },
    {
      "path": "pnpm-lock.yaml",
      "sha256": "b0ec0dfffe8d51163eec6691f283eb7d4c06ac871bae4c1c3b77c2f2f537fdab"
    },
    {
      "path": "apps/web/prisma/schema.prisma",
      "sha256": "0db52a715efadccabcfd45ef69c246bcb27dc4297ff38f9a4a45c9daefbb4aae"
    },
    {
      "path": "apps/web/src/app/api/files/upload/route.ts",
      "sha256": "16364af9b07bd29ae2cc365de193872b0c67b27855c6b6b9ae563783f257645c"
    },
    {
      "path": "apps/web/src/lib/file-upload-client.ts",
      "sha256": "039165b05fd8351422ecdfb7a1674fbbc51bc51f02cf76bbb552d2329e7985fb"
    },
    {
      "path": "apps/web/src/lib/upload-request-context.ts",
      "sha256": "81455e4c022c3829d343b95b1883ce03ba2eb6ed7b26bbb435002755dee61dd2"
    },
    {
      "path": "apps/web/src/lib/s3.ts",
      "sha256": "3fbec72a9873d6b314bdfa0d9fc7965bff9270529e369fdf80d9db25475dfde1"
    },
    {
      "path": "apps/web/src/server/files/upload-target.ts",
      "sha256": "59b4de197bb5f8ee5e4061c985df8665bd31e4c2498b787fde623559c77c6ee8"
    },
    {
      "path": "apps/web/src/server/files/multipart-upload.ts",
      "sha256": "610b6252bc3e410caed5664d7a929731c022f7d4780cd70963e5514656138d0d"
    },
    {
      "path": "apps/web/src/server/files/upload-storage.ts",
      "sha256": "8317ee458c9f14c083b09d9f60716d10f2fb6c43a83909b4c379a667ded40a37"
    },
    {
      "path": "apps/web/tests/file-upload-client.test.ts",
      "sha256": "530c69366b1021f089a9b2d47fdaadd5bcc565f1206e468f251b50804da114ba"
    },
    {
      "path": "apps/web/tests/file-upload-transport-handler.test.ts",
      "sha256": "b3e5dce3da7eefffc9a641608ebaed6ab1e748f810d8a955eb4cc093e422c910"
    },
    {
      "path": "apps/web/tests/multipart-upload.test.ts",
      "sha256": "66a598d996e12f2f5f55555f3c0eaee63d0f15b6eac80f7fe13dcb1d6a91f506"
    },
    {
      "path": "apps/web/tests/s3-upload-reliability.test.ts",
      "sha256": "ae09a604c6752641b99c87fee83236891af00fdd46b5223df4d16986adf7adc1"
    },
    {
      "path": "apps/web/tests/product-attachments-upload-stage.test.ts",
      "sha256": "7cac24cf5f1d877dc3991ebfff4e044cbf802b2a465f4f794d0085670605dd7d"
    },
    {
      "path": "apps/web/tests/upload-route-reliability.test.ts",
      "sha256": "28328a739d1a96502c0721b2798714a5f680938ab28a36dc4b613674504ceaa5"
    },
    {
      "path": "apps/web/tests/helpers/multipart-request.ts",
      "sha256": "57ef7cc0be2ead9f1c08135b81144a2dec60811658f4bacfc123e2f4ad4792fa"
    },
    {
      "path": "apps/web/tests/file-upload-transport-rss.ts",
      "sha256": "e062c0835ecc8635728ffb916fb7254e8851984df1edce04558b4ca4468de069"
    },
    {
      "path": "apps/web/tests/file-upload-transport-rss.test.ts",
      "sha256": "c2bd2276f895d9f1063054e1ed1b46ede0bc54f4d04626148fe0ecfe6a7114b9"
    },
    {
      "path": "apps/web/next.config.ts",
      "sha256": "f0ae3b9476607d09d15fe399cf31a7d6d36e103f15c149490026a70cc2a42ddf"
    },
    {
      "path": "apps/web/Dockerfile",
      "sha256": "b416f3b48782b6a578af0c6df06a004413505541e7047b99e4a6686c5c1375f3"
    }
  ]
}
```

New private producer physicalSHAba8bedc40ddfb92530eb42cbb13aa99fda48e396759451aa8974a3394c2b2d80.

### CURRENT139 runtime API no-effect capsule and operator qualification

No-effect capsule966d74 exit0: current entry e062c0835ecc8635728ffb916fb7254e8851984df1edce04558b4ca4468de069; unauthorized -> RSS139_EXPLICIT_AUTHORIZATION, wrong mode -> RSS139_MODE, relative approval -> RSS139_APPROVAL_FILE. Public process.getActiveResourcesInfo tracked TCPServerWrap/TCPSocketWrap/ProcessWrap [] before and after; direct import did not invoke footer. Actual HTTP/compiler-build/DB/large IO NOT_RUN. Private current producer node --check909481 exit0.

Current design operator section expressly distinguishes historical71f/d1b8 actual source-only closure from new pending currente062 closure. Root seal is external to rss139Main; exact run flags/auth/absolute approval are documented, no fictitious expected-file-sha argument. One600000ms monotonic HTTP matrix budget, finite response/writer/drain and peer abort plus joined10s cleanup/owned exit are source-only reviewed candidates. Root/sourcebuild/runtime windows remain separate; no author effects/approval were created.

## CURRENT root source-only closure421 / proposed runtime01e85 (NOT_RUN)

Root ONE source capture4213147b-db59-414a-acf9-c914cd529f19 completed7468b2 exit0 after e062/ba8 narrow SOURCE_BUILD review. Physical artifact D:/Projects/pero_crm_worktrees/improvements-139/apps/web/test-results/upload-rss139-source-4213147b-db59-414a-acf9-c914cd529f19/closure.json SHA ef38afc15bc8a8944cfdbfe4cc0610bbd4548e92c27216cd98375350dec2c351; sourceHash359453f45b5f371ae40bcc52fe81aeaa0c8a1f7d4ecd6cfe5f6e30fcc83a4909/contextHash04be7ef3b0ffab840bb0ced919e585be4716f492c7ca3922829186c4adaa6518. Actual625metafileinputs/12666uniquephysicalpins/54families; currente062 entry/ba8 producer/21review sourcebeforeafter. This is current source-only capture; independent actual artifact review remains separate. Historical82359/71f and all prior source/STOP artifacts are preserved.

Metadata-only capsule37635e assembled a PROPOSED_NOT_AUTHORIZED wrapper at D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/rss139-runtime-ready-01e85a05-8587-443d-88e5-4b95fc359c23.json SHA0a8bfd3d9d6f8f71d101d0a71f018921f2858c839847100ab1e5a806386e0fc6. Its runtimeApprovalBody is exactversion1/kindrss139-local-http/run01e85a05-8587-443d-88e5-4b95fc359c23/current359source/e062entry/9487matrix/Nodev22.23.1/full12666orderedpins/unchanged32-64MiB and3GiBfree. Wrapper itself is deliberately not a runnable approval and grants no authority.

Prospective exact untouched roots now proposed:
- evidence D:/Projects/pero_crm_worktrees/improvements-139/apps/web/test-results/upload-rss139-01e85a05-8587-443d-88e5-4b95fc359c23;
- spool C:/Users/admin/AppData/Local/Temp/pero-rss139-01e85a05-8587-443d-88e5-4b95fc359c23.

Capsule verified both paths absent, actual ef38 closure physical SHA and orderedfullsourceHash, current entry/producer fields. It never created those runtime directories, imported app/worker/SDK, spawned HTTP/child or evaluated compiler. Old4ef remains unused historical proposal, never replayed. Root may seal only the exact reviewed runtimeApprovalBody into a separate operational JSON after independent artifact/runtime review, fresh source/Node/links verification and exclusive quiet budget/window. Exact direct Node command/API and600000HTTP+separatefinitecleanup budgets in the currentdeadline section apply. Mandatory postverification/ownedchild0/ownspool0, bytes and fixed baseline/memory assertions apply even if a run stops. Actual HTTP/RSS/localFSpublication/MinIO/native/Next/browser/staging/iMac NOT_RUN.

## Runtime launch01e85 STOP before entry / NEW proposed d30c95 (NOT_RUN)

Root launcher c58ae1 stopped before the entry because Node --import tsx ran from the repository root; tsx is a declared web dependency. The prior full source verifier279fc1/d703dd had passed current359source/04becontext. This is not an HTTP/RSS/app failure. Readonly757977 confirmed original01e85 exact spool/evidence paths both absent and source entrye062/producerba8 unchanged. Old operational approval31da, ready wrapper0a8 and STOP remain immutable; no replay of01e85.

Metadata-only bdad06 created NEW PROPOSED_NOT_AUTHORIZED runtime d30c95d8-40f4-404e-ac34-d3c67ed369d2 at D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/rss139-runtime-ready-d30c95d8-40f4-404e-ac34-d3c67ed369d2.json SHA14320a876f18988ac26ef09b36a5c6aef5b365027bed5cabfd6cfba78b08b96b. Exact approvalBody delta was asserted to be only runId/spoolRoot/evidenceRoot; same currentef38/359/04be/e062/full12666/9487/budgets and dependencies. New resource paths were observed absent; no source/module/compiler/HTTP/worker/temp effects were created.

**Required operator working directory: D:/Projects/pero_crm_worktrees/improvements-139/apps/web.** The direct current Node argv remains --import tsx <exactRSS.ts> --authorized-local-transport --mode run --approval-file <new-root-sealed-absoluteJSON>. Public resolve-only from web confirms pinned own node_modules/.pnpm/tsx@4.23.1/node_modules/tsx/dist/loader.mjs; it is already included in currentfullclosure. Do not install or create aliases, use global tsx, or run this command from repoRoot. Child already uses exactweb cwd. External approval seal/source-node-link pre/post verifier/fresh quiet resources and independent narrow condition review/root ONE launch remain required. Source closure rebuild is unnecessary because no source/package/config/link byte changed.

Current exact prospective roots: D:/Projects/pero_crm_worktrees/improvements-139/apps/web/test-results/upload-rss139-d30c95d8-40f4-404e-ac34-d3c67ed369d2 and C:/Users/admin/AppData/Local/Temp/pero-rss139-d30c95d8-40f4-404e-ac34-d3c67ed369d2. No actual HTTP/RSS/MinIO/Next/application/native/staging acceptance is inferred.

## CURRENT tiny HTTP forensic source packet (RED not executed)

Actual RootD30 e4af88 stopped during warmup before case-completed output: STOP RSS139_HTTP_CLOSED, verified ownedchild211608 exitedSIGTERM, senderJoinFailure=null, closed=false. No memory/SDK/application/native acceptance. RootPOST full source verification ce2256/290aec returned unchanged source359/context04be. D30 PREdfe/STOP8db and ef38 closure remain immutable.

Source snapshots f68fa6 preserve exact e062 baseline at D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/rss139-entry-frozen-e062.txt and ba8 collector at rss139-source-closure-frozen-ba8bedc4.txt. Current OS numericPID211608 read-only observationdab9f2 reports svchost, not ownership of original Node; never kill it or claim PIDabsence. Original spawn-handle exit receipt remains the process capability fact.

Readonly spool b8b6cb found exactD30 UUIDroot/no reparse/entryCount0; metadata ed93e7a2 is at rss139-d30-spool-observation.json. Stable bigint inode observation163221 is at rss139-d30-spool-inode-observation.json SHAfb4acd64e3d6ba5457137598c697d71a0c4374c78562d19d33872583c35ccb43: dev2766889857/ino2533274792519827/empty/PRE-stopownershipchain. Cleanup NOT_RUN; any Root nonrecursive empty-leaf rmdir requires fresh exactguard/ownership/ino/empty revalidation and explicit review/approval, never broad deletion/PIDkill/retry.

Root source release exposed the exact existing sender as rss139Send, with optional closed-phase numeric/boolean trace. Existing if(!finishedResponse) close predicate remains deliberately OLD for real RED. Current QAentry SHA9e0af65b52f9d97be23be3a42eb7214adc613c9f30cf9884002b389aa33b6fdf; prior e062 and currentba8/ef38 are historical source facts and do not bind this updated QAentry. Appsource/dependencies/limits unchanged.

Ignored inert probe D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/rss139-http-lifecycle-probe.mjs SHA6c5e304485dac5ca11f278b3d43794807d9fe5b852386c2dc83ca4df04efce01 reuses that same sender, no shadow sender. Exact own127.0.0.1:0 server,64KiB generated file/max70KiBwire,5cases: normal-close/split-json/before-headers/truncated-json/no-end. It verifies encoded wire+SHA, bounded safe phase fields, both positive and specific negative error kinds. HTTPglobal15s/percase2s hardabort; ownsenderjoin2s/serverclose2s are separate cleanup phases. Root callback timestamps/trace are not assumed to prove the suspected Promise-continuation race; RED requires actual normal validreply rejection withrequestclose afterheaders and promiseComplete=false. If not reproduced, STOP rather than silently fixing the hypothesis. Allown sockets/timers/senders mustclose before accepted receipt; cleanup failures retain ordered facts and deny PASS.

Metadata-only58b72f created proposedNOTAUTHORIZED RED fd26cede-1ca8-4d95-9d44-d88716f52c67 at rss139-http-probe-ready-fd26cede-1ca8-4d95-9d44-d88716f52c67.json SHA35b9105875f123de09666c778c2c21758483a9797108f3d9a19d6485e19e8713. Its12666 physical-pin overlay changes ONLY the QAentry path from immutableef38 baseline, sourceHash611994e89755bdbd9d981157775e811ca0d03dd0d70b0c79979292515d3b1293. It expressly makes no new metafile/compiler claim. Root must separately qualify original dependency/resolution/Node controls and exact overlay+probe/externalapproval before one actualtiny HTTP invocation.

Operator cwd D:/Projects/pero_crm_worktrees/improvements-139/apps/web; direct Node --import tsx D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/rss139-http-lifecycle-probe.mjs --authorized-tiny-loopback --approval-file <root-sealed-absolute-json> --expected-file-sha <approval-sha>. Probe is inert unless explicitauthorization/file seal; only the source-onlycold capsules have run. No QAworkerchild/spool/CRMroute/parser/SDK/DB invoked; normal declared Node/tsx preload remains part of the runtime controls.

Actual source checks:27/27 controlledregressions7ba879, entrylint7f4904 zeroerrors/warnings; probe syntaxd81c02/lint074232 zeroerrors/warnings; inert a42b1e2authorization+4trace controls/resources[]; fullweb TSC69637 exit0/0b67de latestQA9e. HTTPRED/HTTPGREEN/largeRSS/realFSpublication/MinIO/realNext/DB/browser/staging remain NOT_RUN. No close predicate change before actualRED. Parent Root alone executes accepted once-protocol; author realHTTP0.

## Ownership handoff and current adapter correction

Root передал №139/140 от storage owner после №150; существующие20WIP entries bugfix/139@cd38 сохранены. Старые labels NOT_RUN выше являются историческими; файловые actual receipts уточняют результаты, они не перезаписаны.

Actual numeric284d9125 уже выполнялся: case-doc25.json SHA977e7d1d8c6c18280db8e73bb5ee75dd8dce912c3ee0891a466318f26378ced9, HTTP200, RSS delta36773888 > frozen33554432; baseline270000128/155239220/149038942, peak306774016/188728121/179906583 для RSS/external/arrayBuffers. STOP RSS139_MEMORY_BOUND, spawn-owned child225628 exitedSIGTERM, closedfalse/retainedSpoolUNKNOWN. Никакой RSS PASS или повтор старого approval не выводится из наличия файла.

Более свежий current6596461d также actual STOP: source357af695…/entrye5c7f8ab…. Уже внесённый потоковый source SHA исправил прежнее чтение большого SWC binary целиком. Saved phases показывают warmed baseline RSS148930560/external6851060/arrayBuffers651123. Doc25 deltas10641408/33321534/33321193 укладываются в32MiB; doc100 deltas11489280/36355473/35306628 превышают external/arrayBuffers. Child44640 spawn-handle exitedSIGTERM; closedfalse/spoolUNKNOWN. Source/transport/S3/app acceptance не объявляется по этим частичным результатам.

Конкретный QA source mismatch: установленный Node22 Readable.toWeb копирует каждый Buffer через new Uint8Array(chunk), а pinned Next15.5.20 NextRequestAdapter.fromNodeNextRequest передаёт NodeNextRequest.body напрямую в NextRequest. Root разрешил узкую замену только QA bridge на этот установленный Node adapter. IncomingMessage заранее pause для byte-count listener без преждевременного flowing; signalFromNodeResponse сохраняет реальную abort-семантику. App source, SDK, parser, cases и frozen32/64MiB thresholds не менялись.

Current QA entry SHA0f7055e8bcb342b12e8afa2c0611f2462b7d5d71c1ac1ba8af2f30961c59e4ce, existing source-pin overlay меняет только этот один entry: sourceHash825c66b215e66049111fd9de73a1ef158a19b265c6a6f3c1039e2fa8dad0eab6. Оба actual adapter modules уже присутствуют в прежнем physical closure; новый registry/метаграф не создан. Existing seven affected suites **96/96 PASS**, process3.18s, full strict TypeScript/scoped QA-entry ESLint/diff PASS. Inert import resources[]/entryAPIfunction, HTTP/child/largeIO0. Actual new RSS runtime **NOT_RUN** до independent review + fresh Root ONE; реальные Next server/SDK wire/MinIO/native/staging остаются отдельными pending scopes.

Readonly exact old spool facts: TEMP/pero-rss139-284d9125… dev2766889857/ino39406496739526537/empty; TEMP/pero-rss139-6596461d… dev2766889857/ino5348024557725424/empty. Physical paths match, directory/ancestor reparse-free. Ничего не удалено; точечный nonrecursive empty-leaf cleanup требует Root отдельного решения и fresh inode/empty checks. Чужие PID не использованы для завершения процессов. №140 ещё не открыт и storage138/151 source не меняется.
# QA metric correction and focused attribution — current139

Independent FINAL_LOCAL_TRANSPORT_GO +CODE_COMMIT_GO accepted Root for exact26 own source/test/docs/OpenSpec paths. Accepted local scope is source-equivalent preservedfive large cases plus strict833c lasttwo, not a single seven-case rerun. No further runtime or ignored-private artifacts in commit. Full NextServer/SDKwire/MinIO/nativeDB/staging remain explicitly pending. Owner all-plan commit authorization persists; integration/push only Root, main/production forbidden.

STRICT TAIL833cbe30-cad3-4fc9-bbfc-695db5247540 CLOSED5615 EXIT0/TAIL_PASS, result SHA67c673d47fc44c241d4103ce54cb8496459eb71be8407b83059959651bcebb81; caseScopeLAST_TWO_ONLY, TRANSPORT_BUFFERS_PASS, noGC. Child309272 exitedcode0 withoutkill, active0/errors[], SDK/sourcepost restored, own0/exact currentemptyspoolremoved. Control413 responsefinish genuine; sameWebreader advances36 bytes (received65682→65718), Incoming ended=true/aborted=false/length0. Both control andmalformed400 strictLIVE0/disposed0 BEFOREaccountingremoval PASS. Controlledtransport upper9281271/9150622 bytes<32MiB.

Combined local transport packet is original18f's fivecompleted25/100/1024/parallel100/image25+1 plus833c strictlast2. It is NOT labelled a single rerun ofseven. Application transport source multipartdd480 and publishing/S3 handler logic/limits/bodygenerator/matrix9487 unchanged between those runs; entry changes aftercf30 are only diagnostic observation/scopedselection and actual lifecyclecleanup ofknowncontrol. Thus the five large raw memory/hash/status/queue assertions remain source-equivalent, no1GiB repeat. Independent acceptance ofthat combination pending; fullNextserver/SDKwire/MinIO/nativeDB/staging remain NOT_RUN. Original partialSTOP/diagnostics/hypothesisfailures immutable, not renamed PASS. Current finalentry fb0f900aca6d2d60c03947688f10ee65e1e3af9a6627ebc24a5f9897ce59186b/source3fcc3456212245d819739d42c18fe949c81379435e2570605230c85b8bc2781a, existingcoldtest8f985 unchanged.

Actual control-only1541a30b76634 EXIT1/SIGTERMownedchild315512 retainedSTOP b1ba35c41bedaf83a3eeeb587fccec8a2737e31d67e12cc80667fd5294fd8c0a. Finite lifecycle proof: caught413 Incoming complete=true/destroyed=false/aborted=false/ended=false/length36/received65682; responsefinish=true and control-response-finish emitted; after10s control-drain-failed codeRSS139_CONTROL_INPUT_FINISH with identical36 bytes/state. This is an input-drain timeout, not premature-close. No metadata/SLO/fullclosure PASS.

Exact installed primary source explains the mismatch: Next15.5.20 passes Node body into Undici, whose ReadableStreamFrom owns iterable[Symbol.asyncIterator](). Node22 resume explicitly does not enter flowing mode while a readable listener exists. The second raw IncomingMessage.resume consumer cannot advance that retained iterator. Root approved QA-only correction to read the SAMEadaptedRequest.body publicreader after prior spool.releaseLock, after genuine responsefinish, with same finite wire/timecap; EOF must produce actualIncoming.readableEnded/length0 before strictdisposed0. No counter filtering/zeroise/GC/production change.

Current reader-only delta entryfb0f900aca6d2d60c03947688f10ee65e1e3af9a6627ebc24a5f9897ce59186b/source3fcc3456212245d819739d42c18fe949c81379435e2570605230c85b8bc2781a; productiondd480 unchanged. Existing38caps/lint/inert/resources[] PASS, normalmodel/cases/preservedold5 unchanged. Proposed833cbe30-cad3-4fc9-bbfc-695db5247540 Droot/.playwright-mcp/application-improvements/rss139-tail-verify-ready-833cbe30-cad3-4fc9-bbfc-695db5247540.json SHAbe1e8a2fe67728c8bbec74bc0fca72030648c76ef7193e47e27d72a62456b689 selects ONLYlast2strict/noGC; actualNOTRUN until reviewed RootONE. Earlier holds/diagnostics remain unchanged, no large cases repeated.

Strict tail a040609f actual55140 EXIT1: workerSTOP during control lifecycle cleanup before memory/snapshot; no TAIL_PASS. Child313260 exactspawn exitedSIGTERM, senderJoin/null, phaseFailure/null, failures[], closed=false. Inner error was collapsed to HANDLER_UNKNOWN/WORKER_STOP; do not infer premature-close cause. No large repeat, malformed not reexecuted in that attempt. Existingfive large receipts and 146 diagnostic remain unchanged.

Root-authorized next delta ONLY observability: existing bounded phase journal now records tail lifecycle responsefinish/inputend/inputclose/destroyed/aborted/readableEnded/readableLength and finite whitelisted Node error codes before HANDLER_UNKNOWN. No stacks/raw messages/PII. Original guard/drain logic/production/model unchanged. diagnosticControl:true selects ONLY existing65537-byte control, skips warmups, alwaysDIAGNOSTIC_ONLY/NOT_ACCEPTANCE/noGC; any failed strict guard remains STOP. Current proposed1541a30b-0ff5-475e-9b49-cf61957a2dd6 path Droot/.playwright-mcp/application-improvements/rss139-control-observe-ready-1541a30b-0ff5-475e-9b49-cf61957a2dd6.json SHAe9f768f9c8cca4b2abe3b6c100a95575cf53222bf33c62d31f7d7ecbb2364331. Entry1b9ce41ccfca72a65faf65a3598ee9882d8ed5b2d421cd682e743127d88a5664/source dd2565f737924f5359bd0c66fd767c2b1233c84c27d2a2c78d5b6cdf436a9148; productiondd480 unchanged. Existing38caps/lint/inert/resources[] PASS. New runtime NOT_RUN until tinyreview/Root ONE; unused9e446 intermediateproposal retained, neverexecuted.

Actual tail diagnostic14609910 CLOSED93258 EXIT0/DIAGNOSTIC_ONLY/NOT_ACCEPTANCE, result SHA9608159312d39facab54cfc6f06ae44edb7aaac58e8676d1e5a583439c371964. Control65537 actual413 retained exactly NETWORKREAD36 at disposed capture; pending/parser/part/transform/fileWrite/spoolReaders/storageRead all0, guard explicitlyFAIL. Malformed8 actual400 disposedALL0/guardPASS. Child270612 exitedcode0 withoutkill, SDK/source restored, own0/exact empty current spool removed. This is attribution, not full acceptance. Old18f own empty leaf removed only after Root exactdev/ino/reparse/empty/closed-child guards; cleanupreceipt30e8bea0e831a72a53e6957e5c15b0201918b63b96e1f13a0ff7d39c4db8739a, oldlogs retained.

Root approved narrow QA-only lifecycle correction: ONLY ownadmitted control id/maxFileHWM/sizeHWM+1/actual413 waits genuine JSON responsefinish, then resumes/drains that IncomingMessage under its exact bounded wire cap(size+128KiB) and10s deadline. No global zeroise, masking, GC, production/chunk/model change. Strict disposed/live0 remain unchanged. New verifyTail:true selects only existinglast2 with strict gates and scoped TAIL_PASS; original5large notrerun. Current entry338fbb17f39cf3b6a2312039fcfd022e51ff7d105143172c5133b2514dfb8053/source2a070e7e6626ce24168fcc949ae6c2a77443d22f1e5246bf626413ef1a27d28b; productiondd480 unchanged. Current proposed a040609f-c006-4d06-8c0b-3f4b9fd53ea4 file Droot/.playwright-mcp/application-improvements/rss139-tail-verify-ready-a040609f-c006-4d06-8c0b-3f4b9fd53ea4.json SHA6f3badf027c8ff285a578072f4f6635ee03ea2bdc05b2911f22973487dc2abc6. Lint/inert/resources[] PASS, no actual tail verification before reviewed Root ONE. Earlier raw observations/STOP/diagnostic remain immutable.

Actual18f984ae after explicit Root metadata-rebind: original seal331f retained; stale approved QA.test b353→8f985 corrected ONLY in versioned approval860d6076b59dd598c72c5d169b899231a77e50407f73bbafae761542b232afc1/sourcefbcbea3671f575031db40138f2e83b69a63755e7f4d1eb75bcd23ce06558467c. Earlier preparation STOP was before PRE/HTTP/child/spool (both resource paths absent), finite cause retained at rss139-18f984ae-prepare-hold.json SHAdacbbecc44c0e3a13b8999c2ff88bf25390387451db7f7f285ae6070150bb423. Entrycf30/multipartdd480/cases/baseline/node unchanged.

First actual series11485 EXIT1: doc25/doc100/doc1024/parallel100/image25-plus1 completed all existing assertions before stdout. Transport upper estimates9485705/9507147/9821941/19011929/9485779 bytes, below unchanged32/64MiB. Raw process observations saved without GC: doc25 peak RSS156803072/external36686510/array30072316; doc100159997952/41799883/35298879; doc1024165306368/42509384/35751370; parallel100165994496/42450762/35806894. Input grows40.96×, raw peaks/transport do not grow proportionally. Theoretical upper17145862/upload,34291724/two is independent of input size.

Control-limit-plus1 actual413 then STOP RSS139_TRANSPORT_DISPOSED_DRAIN (stop SHA414d956461245984ab28cf2986ef5f2254374678155ae6aee0f9581fcd6f136d). Disposed numeric snapshot was not durable before the assertion, so its values/which queue are NOT_KNOWN; no invented diagnosis. Last malformed-end NOT_RUN. Own child316000 exitedSIGTERM via exact spawn capability, senderJoinFailure/null, phaseFailure/null, failures[], closed=false. No full-series/SLO/normal closure PASS. Current exact top-level spool readonly has symlink=false/dev2766889857/ino47850746040842287/entryCount0; leaf remains retained, no cleanup authority inferred.

Narrow QA correction now persists all raw queue snapshots BEFORE budget/drain checks. Proposed diagnosticTail executes ONLY existingcontrol-limit-plus1 andmalformed-end, always DIAGNOSTIC_ONLY/NOT_ACCEPTANCE/noGC; failed disposed guard is explicitly recorded FAIL and does not prevent the second diagnostic case. Normal original series retains strict disposed0. Production/chunks/model unchanged. Inert Node Readable fact separately proved destroy+closed can leave readableLength8: this is only a source hypothesis aid, not attribution of the lost actual snapshot. New exact proposal Droot/.playwright-mcp/application-improvements/rss139-tail-diagnostic-ready-14609910-6a62-460a-991b-be8fa291a4d1.json SHAe06b93ca460e321207a634142300b2d896c37db01ffea4afef36052717d228b1, entryc35ac11138b75ad42dd348fe17a8cebcb14658ae0745612d64a38c037b607b3d/source5a4b4f836478543210ab3c967e2deba94e66957437ac4618bb0d42be711705b1. Current multipartdd480 unchanged. Lint/inert/resources[] PASS; proposed paths absent; actual tiny diagnostic NOT_RUN until reviewed Root ONE. Previous five large cases/STOP unchanged, no large repeat.

Final narrow review correction: entry now also asserts sum(snapshot.disposedQueues)===0 before TRANSPORT_BUFFERS_PASS; this uses the last captured queues before reader accounting is removed and is independent of the final empty reader map. No model/cases/baseline/GC/production change. Entry cf30a60acb409decebec3d613a3d0e35317655970a973c2fcb6beead3176f7f2; overlay source85d9f7ea9b5a857459f3884b4d496e7b4f1dce51ddb00df9b2e52676c5ecf5d8. Cold no-input/inert/resources[] and scoped lint PASS, no repeat matrix. Updated proposed18f984ae-7b0a-4d2b-844a-7c7a1a44a9f1 ready SHA8b4993731b3c10932dc40f6d4b4206e3cb9d05dee2e46d1d150bc3b8fc16f127, paths absent; earlier f1fc proposal retained unused. Runtime still NOT_RUN pending Root ONE.

Root explicitly approved alignment to the original task139 criterion: 32MiB constrains the complete live transport buffer, not all Node process memory. The business spec/plan remain unchanged. Production input/HWM/chunk sizes and dependencies are unchanged. Current QA entry records all public live queues, conservative fixed live-slot reserves and hard per-queue/input/theoretical32/64MiB bounds. Raw RSS/external/arrayBuffers retain the original pre-matrix baseline and exact peaks/deltas; normal seven-case series invokes no GC. The historical focused diagnostic remains DIAGNOSTIC_ONLY.

Actual focused46994001-7f0e-4646-a1db-52d64f6d1307 finished96510 EXIT0 DIAGNOSTIC_ONLY. Original doc100 HTTP200 measured deltas RSS33804288/external36028006/arrayBuffers34621876 exceeded the historical incorrect process32MiB gate, saved BEFORE GC (case813edf009e39be0abf8ef5778eae479d1ed606c9c26dc28ca54c73c240168a74). Observed live queue maxima sum approximately356KiB; disposed/drained queues0. Separate diagnostic post-measure GC reduced external to6277488 and arrayBuffers103977, proving that the large observed allocations were unreachable by that point; this is not SLO acceptance. Child281168 exited code0 without kill, own0/current exact empty spool removed after guards, SDK restored/source postverified. Result SHA8c5b4ad259b02430dc544c9243158b4932aa6ba5e68a47383f0921d1dbefa82b. Earlier98 STOP and its retained spool are unchanged.

Current targeted52/52 existing RSS/parser regressions PASS, scoped ESLint zero errors/warnings, strict OpenSpec/diff PASS. The existing memory regression now verifies raw signed process observations separately from the complete hard transport budget and rejects missing/nonfinite/excess queue/input facts; no extra test cases/framework were added. Inert import/no-input authorization refusal/resources[] PASS. Theoretical complete upper bound17145862 bytes/upload,34291724 bytes/two; includes possible HWM overshoot, shared-buffer overcount and all unobserved fixed input/header/metadata/base64/write/read/hash slots. Actual original seven-case acceptance remains NOT_RUN until reviewed Root ONE.

Ready metadata only: D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/rss139-transport-budget-ready-f1fc0432-c621-41a4-aa18-28251d821e96.json SHAfb805db4983b8d3948947bc18d5e4ed9354abf46c613d1e3e4dcc6cd9ce49209. Current entrydf7d5fd3a5c183e20dc9e19e0d975d5814313dfa31b7730d21214d21fc9da76f; multipartdd480a8aa3212085003d8a75ff1c2cc2f8308315810e9f3ea2c3a7b13d9facf7 unchanged; existing physical closure overlays only QAentry→sourcef62f701e3d83e41d68e12653f1f8b4080ba9b190ddd11003a56ae21157a3c376. Same matrix9487/Node22.23.1/32+64MiB/3GiB free/finite deadlines, new prospective UUID paths absent. No runtime authority is granted by this prepared file. Proof scope remains actual installed NextRequest adapter/Node HTTP/parser/original stream/mock SDK; real deployed Next/SDK wire/MinIO/staging/DB separately NOT_RUN. Main/production/restic/dumps/newDB/seed remain forbidden; SAFETY-RULES STOP on guard mismatch.

## Совместимость CI fixture после streaming139 — 2026-10-13

На интегрированном e4878307 старый setup `file-captions-retired.test.ts` предоставлял только `formData()`, тогда как route139 читает настоящие headers/signal/body. Setup заменён на multipart `Request`; S3 stub теперь дожидается чтения owned spool через `s3PutStream` перед прежней намеренной ошибкой storage. Все существующие assertions сохранены: caption422 до чтения stored bytes/storage/DB, обычная загрузка доходит до `storage-original`, legacy metadata неизменны, typed cover writer отказывает до TX. Единственный запуск этого файла f28af9: **3/3 PASS**; scoped ESLint c512de: **0 errors / 0 warnings**; independent CODE_GO для fixture SHA44f437383c56d29b39f52190ee5dfa04e5c51fff48ffb28534f2cd99df28397b. Production-код не изменялся; повтор CI/deployed staging и actual S3 этой записью не подтверждаются.
