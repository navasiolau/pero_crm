import assert from 'node:assert/strict';
import test from 'node:test';
import {finalJournalScope} from './product-modernization-final-stage-runner.mjs';
const fixture={actors:{admin:{id:'actor'}},ids:{project:'project',productA:'a',productB:'b'}};
const upload={type:'file-upload',actorId:'actor',projectId:'project',productId:null,fileId:'file',saved:true};
const journal=ownWrites=>({ownWrites,preferenceOwnWrites:[]});
test('flat own project upload/delete is bounded to its captured file subject',()=>{
 assert.deepEqual(finalJournalScope(fixture,journal([upload,{...upload,type:'file-delete'}])).mutationIds,[]);
 assert.throws(()=>finalJournalScope(fixture,journal([{...upload,type:'file-delete',fileId:'unknown'}])),/DELETE_WITHOUT_CAPTURED_UPLOAD/);
});
test('unknown project file is rejected before inspection or cleanup',()=>{
 assert.throws(()=>finalJournalScope(fixture,journal([{...upload,projectId:'foreign'}])),/SUBJECT_STOP/);
 assert.throws(()=>finalJournalScope(fixture,journal([{...upload,productId:'a',projectId:'foreign'}])),/FILE_SCOPE_STOP/);
});
test('project scope never permits scalar or percentage writers without an owned product',()=>{
 assert.throws(()=>finalJournalScope(fixture,journal([{...upload,type:'field',field:'title'}])),/SUBJECT_STOP/);
 assert.throws(()=>finalJournalScope(fixture,journal([{...upload,type:'percentage'}])),/SUBJECT_STOP/);
});
