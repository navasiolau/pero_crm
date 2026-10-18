import { test } from "node:test";
import assert from "node:assert/strict";
import { RetentionError,mergeRetentionProgress } from "../src/server/kp/retention-contract";
import { executeProposalRetention } from "../src/server/kp/retention-executor";
import { planProposalRetention } from "../src/server/kp/retention-policy";
import { acceptedPayload, retentionFixture, retentionTime } from "./helpers/kp-retention-fixture";

test("canceled unknown-ACK request never reopens a still-uncertain object for readers",async()=>{
  const f=retentionFixture(), plan=planProposalRetention(f.snapshot,acceptedPayload,retentionTime);
  plan.targets.forEach(target=>f.seed(target));
  const deletion=f.storage.deleteVersion;
  f.storage.deleteVersion=async()=>{f.cancel();throw new RetentionError('KP_RETENTION_STORAGE_FAILED',true);};
  await assert.rejects(executeProposalRetention(f.dependencies,await f.acquire()),/STORAGE_FAILED/);
  assert.equal(f.progress!.objects[plan.targets[0].id].versions[0].phase,'INTENT');
  f.storage.deleteVersion=deletion;f.beginProbe();
  const firstProbe=await f.acquire();
  await assert.rejects(executeProposalRetention(f.dependencies,firstProbe),/PROBE_UNRESOLVED/);
  assert.equal(f.progress!.objects[plan.targets[0].id].releasedAt,undefined);
  await f.repository.fail(firstProbe,new RetentionError('KP_RETENTION_PROBE_UNRESOLVED',true));
  assert.equal(f.state,'PENDING');
  const oldArtifact=f.snapshot.artifacts.find(artifact=>artifact.id===plan.targets[0].entityId)!;
  assert.equal(oldArtifact.state,'RETIRING');
  assert.ok(f.objects.get(plan.targets[0].key)!.length>0);
  assert.equal(f.events.filter(event=>event.startsWith('delete:')).length,0);
  assert.ok(f.snapshot.media.every(media=>media.retiringAt===null));
  // Исходный запрос позже завершился; следующая сверка узнаёт физическое отсутствие без новых Delete.
  f.objects.set(plan.targets[0].key,[]);
  await executeProposalRetention(f.dependencies,await f.acquire());
  assert.equal(f.state,'SUCCEEDED');assert.ok(f.progress!.objects[plan.targets[0].id].absentAt);
  assert.equal(f.events.filter(event=>event.startsWith('delete:')).length,0);
});

test('late ACK merges monotonically into pending probe without losing an absence proof',()=>{
  const f=retentionFixture(),manifest=planProposalRetention(f.snapshot,acceptedPayload,retentionTime),id=manifest.targets[0].id;
  const current={manifest,objects:{[id]:{versions:[{id:'v1',marker:false,phase:'INTENT' as const}],absentAt:'2026-10-18T12:00:00.000Z'}}};
  const source={manifest,objects:{[id]:{versions:[{id:'v1',marker:false,phase:'DELETED' as const}]}}};
  const result=mergeRetentionProgress(current,source);
  assert.equal(result.objects[id].versions[0].phase,'DELETED');assert.ok(result.objects[id].absentAt);
  mergeRetentionProgress(result,{manifest,objects:{[id]:{versions:[{id:'v1',marker:false,phase:'DISCOVERED'}]}}});
  assert.equal(result.objects[id].versions[0].phase,'DELETED');
});
