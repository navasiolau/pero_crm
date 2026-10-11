// Только локальный measured Node run; DB/native/staging этот инструмент не запускает.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,readdir,writeFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectCoverage,digest,sourceInputs,unchangedInputs,validateMatrix} from './coverage-baseline-core.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)), web=path.resolve(here,'..'), root=path.resolve(web,'../..');
const arguments_=process.argv.slice(2);
assert.ok(arguments_.every(value=>value==='--check'),'COVERAGE_EXPLICIT_CHECK_OR_FULL_RUN_ONLY');
const matrix=JSON.parse(await readFile(path.join(root,'docs/testing/contract-matrix.json'),'utf8'));
const targets=await validateMatrix(root,matrix);
const package_=JSON.parse(await readFile(path.join(web,'package.json'),'utf8'));
assert.equal(package_.scripts.test,matrix.ci.webEntry,'CI_WEB_ENTRY_CHANGED_REVIEW_REQUIRED');
const tests=(await readdir(here)).filter(file=>/\.test\.(ts|mjs)$/.test(file)).sort();
if (arguments_.includes('--check')) {
  console.log(JSON.stringify({status:'PASS',scope:'matrix-paths/test-blocks/CI-entry',contracts:matrix.contracts.length,dispositions:matrix.dispositions.length,targets:targets.length,testFiles:tests.length}));
} else {
  const revision=execFileSync('git',['-c','safe.directory='+root,'-C',root,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
  assert.match(revision,/^[a-f0-9]{40}$/,'SOURCE_REVISION_REQUIRED');
  const before=await sourceInputs(root), startedAt=new Date().toISOString();
  const relative=path.join('.playwright-mcp','coverage-baseline',randomUUID()), output=path.join(root,relative);
  await mkdir(output,{recursive:true});
  for (let directory=output;directory!==root;directory=path.dirname(directory)) assert.ok(!(await lstat(directory)).isSymbolicLink(),'PRIVATE_COVERAGE_PATH_SYMLINK');
  assert.equal(await realpath(output),output,'PRIVATE_COVERAGE_PATH_REDIRECTED');
  const rawDirectory=path.join(output,'v8'), reporterFile=path.join(output,'tests.json');
  await mkdir(rawDirectory);
  // Ни production credentials, ни DATABASE_URL, ни inherited Node hooks сюда не попадают.
  const environment={};
  const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','HOME','HOMEDRIVE','HOMEPATH','COMSPEC','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PLAYWRIGHT_BROWSERS_PATH']);
  for (const [key,value] of Object.entries(process.env)) if (allowed.has(key.toUpperCase())) environment[key]=value;
  environment.NODE_V8_COVERAGE=rawDirectory;
  environment.NEXT_TELEMETRY_DISABLED='1';
  const command=['--enable-source-maps','--import','tsx','--test','--test-concurrency=2',
    '--test-reporter=tap','--test-reporter=./tests/coverage-baseline-reporter.mjs',
    '--test-reporter-destination=stdout','--test-reporter-destination='+reporterFile,...tests.map(file=>'tests/'+file)];
  const log=createWriteStream(path.join(output,'tests.private.log'),{flags:'wx',mode:0o600});
  console.log(JSON.stringify({status:'RUNNING',target:'local-node-coverage',revision,inputsDigest:before.digest,output:relative,testConcurrency:2,testFiles:tests.length}));
  const child=spawn(process.execPath,command,{cwd:web,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  const report={schemaVersion:1,revision,startedAt,target:'local-node-coverage',runtime:process.version,platform:process.platform,
    executable:path.basename(process.execPath),command:['node',...command.map(value=>value.replaceAll(root,'<worktree>'))],
    inputs:before,ciWebEntry:matrix.ci.webEntry,testFiles:tests.map(file=>'apps/web/tests/'+file),
    status:'BLOCKED',failure:null,
    evidenceBoundaries:{nativePostgreSQL:'NOT_RUN',httpRuntime:'NOT_RUN',stagingBrowser:'NOT_RUN',iMac:'BLOCKED',
      lineCoverage:null,branchCoverage:null,globalCoverage:null,
      reason:'Измерены только source-mapped authored V8 observations Node. tsx helpers и VM/browser bundle не включаются в знаменатель; проценты TS линий/ветвей недоступны.'}};
  try {
    report.exitCode=await completion;
    const after=await sourceInputs(root);report.inputsAfterDigest=after.digest;
    unchangedInputs(before,after);
    const measured=JSON.parse(await readFile(reporterFile,'utf8'));
    report.nodeTestSummary=measured.summary;
    report.executedTestFiles=measured.files.map(item=>({...item,file:path.relative(root,item.file).split(path.sep).join('/')}));
    assert.equal(report.exitCode,0,'NODE_TEST_RUN_FAILED');
    assert.ok(measured.summary?.success===true && measured.summary.counts.failed===0,'INCOMPLETE_TEST_REPORT');
    assert.ok(tests.every(file=>report.executedTestFiles.some(item=>item.file==='apps/web/tests/'+file&&item.failed===0)),'TEST_FILE_EVIDENCE_MISSING');
    report.modules=await collectCoverage(root,targets,rawDirectory);
    assert.ok(report.modules.some(module=>module.status==='MEASURED'),'NO_AUTHORED_COVERAGE');
    report.status='PASS';
  } catch(error) {
    report.status=(report.exitCode&&report.exitCode!==0)||error?.message==='SOURCE_INPUT_CHANGED_DURING_RUN'?'FAIL':'BLOCKED';
    report.failure=typeof error?.message==='string'&&/^[A-Z_]+$/.test(error.message)?error.message:'COVERAGE_REPORT_INCOMPLETE';
    process.exitCode=1;
  } finally {
    report.finishedAt=new Date().toISOString();
    await new Promise(resolve=>log.end(resolve));
    await writeFile(path.join(output,'coverage.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify({status:report.status,revision,inputsDigest:before.digest,failure:report.failure,
    testCounts:report.nodeTestSummary?.counts??null,measuredModules:report.modules?.filter(module=>module.status==='MEASURED').length??0,
    moduleGaps:report.modules?.filter(module=>module.status!=='MEASURED').map(module=>({file:module.file,status:module.status}))??[],
    report:path.join(relative,'coverage.json'),reportSha256:digest(await readFile(path.join(output,'coverage.json')))}));
}
