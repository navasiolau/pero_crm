import { test } from "node:test";
import assert from "node:assert/strict";
import { RetentionError, retentionAnniversary } from "../src/server/kp/retention-contract";
import { executeProposalRetention } from "../src/server/kp/retention-executor";
import { planProposalRetention } from "../src/server/kp/retention-policy";
import { acceptedPayload, fact, retentionBinding, retentionFixture, retentionSnapshot, retentionTime } from "./helpers/kp-retention-fixture";

test("versioned cleanup persists manifest/version intents, paginates exact key and proves physical absence", async () => {
  const f = retentionFixture(), plan = planProposalRetention(f.snapshot, acceptedPayload, retentionTime);
  for (const target of plan.targets) {
    f.seed(target, 4, true);
    f.objects.set(target.key + ".neighbor", [{ id: "neighbor-version", marker: false, bytes: Buffer.from("unrelated original") }]);
  }
  const kept = f.snapshot.media.find(media => media.id === "shared")!.optimized!.key;
  f.objects.set(kept, [{ id: "kept", marker: false, bytes: Buffer.from(kept) }]);
  await executeProposalRetention(f.dependencies, await f.acquire());
  assert.equal(f.state, "SUCCEEDED");
  assert.deepEqual(f.snapshot.versions.map(version => version.id), ["accepted"]);
  for (const target of plan.targets) {
    assert.deepEqual(f.objects.get(target.key), []);
    assert.equal(f.objects.get(target.key + ".neighbor")!.length, 1);
    assert.ok(f.progress!.objects[target.id].absentAt);
    assert.equal(f.progress!.objects[target.id].versions.length, 5);
    assert.ok(f.progress!.objects[target.id].versions.every(version => version.phase === "DELETED"));
  }
  assert.equal(f.objects.get(kept)!.length, 1);
  assert.ok(f.events.indexOf("manifest-persisted") < f.events.findIndex(event => event.startsWith("list:")));
  assert.ok(!f.events.some(event => event.startsWith("delete:") && event.includes("neighbor")));
  assert.equal(f.snapshot.artifacts.find(artifact => artifact.kind === "DOCX")!.state, "READY");
});

test("unknown Delete ACK resumes durable exact versions without broad deletion or metadata completion early", async () => {
  const f = retentionFixture(), plan = planProposalRetention(f.snapshot, acceptedPayload, retentionTime);
  plan.targets.forEach(target => f.seed(target, 2, true));
  let failed = false;
  f.control.onDelete = async () => { if (!failed) { failed = true; throw new RetentionError("KP_RETENTION_STORAGE_FAILED", true); } };
  const firstClaim = await f.acquire();
  await assert.rejects(executeProposalRetention(f.dependencies, firstClaim), /STORAGE_FAILED/);
  assert.ok(!f.progress!.objects[plan.targets[0].id].absentAt);
  assert.equal(f.snapshot.versions.length, 2);
  assert.ok(f.progress!.objects[plan.targets[0].id].versions.some(version => version.phase === "INTENT"));
  await f.repository.fail(firstClaim, new RetentionError("KP_RETENTION_STORAGE_FAILED", true));
  const fingerprint = f.progress!.manifest.fingerprint;
  await executeProposalRetention(f.dependencies, await f.acquire());
  assert.equal(f.progress!.manifest.fingerprint, fingerprint);
  assert.equal(f.state, "SUCCEEDED");
  assert.ok(plan.targets.every(target => f.objects.get(target.key)!.length === 0));
});

test("non-versioned fallback uses exact tracked null version and still requires absence", async () => {
  const f = retentionFixture(), plan = planProposalRetention(f.snapshot, acceptedPayload, retentionTime);
  plan.targets.forEach(target => { f.seed(target); f.unversioned.add(target.key); });
  await executeProposalRetention(f.dependencies, await f.acquire());
  for (const target of plan.targets) {
    assert.deepEqual(f.progress!.objects[target.id].versions, [{ id: null, marker: false, phase: "DELETED" }]);
    assert.ok(f.events.includes("delete:" + target.key + ":null"));
  }
});

test("unexpected checksum prevents deleting the encountered object", async () => {
  const f = retentionFixture(), plan = planProposalRetention(f.snapshot, acceptedPayload, retentionTime);
  plan.targets.forEach(target => f.seed(target));
  f.objects.get(plan.targets[0].key)![0].bytes = Buffer.from("foreign bytes unexpectedly reused this key");
  await assert.rejects(executeProposalRetention(f.dependencies, await f.acquire()), /CHECKSUM_CHANGED/);
  assert.equal(f.events.filter(event => event.startsWith("delete:")).length, 0);
  assert.equal(f.snapshot.versions.length, 2);
});

test("binding change mid-I/O stops further network mutations and keeps durable ACK", async () => {
  const f = retentionFixture(), plan = planProposalRetention(f.snapshot, acceptedPayload, retentionTime);
  plan.targets.forEach(target => f.seed(target, 2));
  f.control.onDelete = async () => { f.setBinding({ ...retentionBinding, bucket: "unexpected-unit" }); };
  await assert.rejects(executeProposalRetention(f.dependencies, await f.acquire()), /STORAGE_CHANGED/);
  assert.equal(f.events.filter(event => event.startsWith("delete:")).length, 1);
  assert.ok(f.progress!.objects[plan.targets[0].id].versions.some(version => version.phase === "DELETED"));
});

test("return to Lead cancels remaining deletes; reconciliation is read-only and releases untouched fences", async () => {
  const f = retentionFixture(), plan = planProposalRetention(f.snapshot, acceptedPayload, retentionTime);
  plan.targets.forEach(target => f.seed(target, 2));
  let once = false;
  f.control.onDelete = async () => { if (!once) { once = true; f.cancel(); } };
  await assert.rejects(executeProposalRetention(f.dependencies, await f.acquire()), /CANCELLED/);
  const before = f.events.filter(event => event.startsWith("delete:")).length;
  assert.equal(before, 1);
  assert.equal(f.snapshot.versions.length, 2);
  f.beginProbe();
  await executeProposalRetention(f.dependencies, await f.acquire());
  assert.equal(f.events.filter(event => event.startsWith("delete:")).length, before);
  assert.ok(f.snapshot.media.every(media => media.retiringAt === null));
  assert.equal(f.snapshot.versions.length, 2);
});

test("year purge deletes accepted images but retains independent product keys, PDF and DOCX", async () => {
  const snapshot = retentionSnapshot(); snapshot.proposal.createdAt = new Date("2020-01-01T00:00:00Z");
  const payload = { schema: 1 as const, kind: "ANNUAL_MEDIA" as const, proposalId: "proposal", expiresAt: retentionAnniversary(snapshot.proposal.createdAt).toISOString() };
  const f = retentionFixture(payload, snapshot), plan = planProposalRetention(snapshot, payload, retentionTime);
  plan.targets.forEach(target => f.seed(target, 2, true));
  const independent = "project/kp-11111111-1111-4111-8111-111111111111.jpg";
  f.objects.set(independent, [{ id: "file-copy", marker: false, bytes: Buffer.from("kept product image") }]);
  await executeProposalRetention(f.dependencies, await f.acquire());
  assert.ok(snapshot.media.every(media => media.originalPurgedAt && media.optimizedPurgedAt));
  assert.equal(f.objects.get(independent)!.length, 1);
  assert.equal(snapshot.versions.length, 2);
  assert.ok(snapshot.artifacts.every(artifact => artifact.state === "READY"));
});

test("pagination cursor loops fail safely instead of expanding scope", async () => {
  const f = retentionFixture(), target = planProposalRetention(f.snapshot, acceptedPayload, retentionTime).targets[0];
  f.seed(target);
  f.storage.list = async () => ({ entries: [], next: { key: target.key, version: "same" } });
  await assert.rejects(executeProposalRetention(f.dependencies, await f.acquire()), /CURSOR_INVALID/);
  assert.equal(f.events.filter(event => event.startsWith("delete:")).length, 0);
});

test("stalled digest renews the existing120s lease serially beyond120s of virtual time", async () => {
  const f = retentionFixture(), plan = planProposalRetention(f.snapshot, acceptedPayload, retentionTime); plan.targets.forEach(target => f.seed(target));
  const guard = f.repository.guard, digest = f.storage.digest; let now = 0, leaseUntil = 120_000, heartbeat: (() => void) | undefined;
  let active = 0, maximum = 0, ticks = 0, cancellations = 0, first = true;
  f.repository.guard = async (claim, target) => {
    active++; maximum = Math.max(maximum, active);
    try { assert.ok(now < leaseUntil, "existing lease must remain valid"); await Promise.resolve(); await guard(claim, target); leaseUntil = now + 120_000; }
    finally { active--; }
  };
  f.storage.digest = async (...args) => {
    if (first) {
      first = false; assert.ok(heartbeat, "digest must install a heartbeat before stalled network I/O");
      for (let index = 0; index < 8; index++) { now += 20_000; ticks++; heartbeat(); heartbeat(); await new Promise<void>(resolve => setImmediate(resolve)); }
      assert.ok(now > 120_000); assert.ok(now < leaseUntil); assert.equal(args[4]?.aborted, false);
    }
    return digest(...args);
  };
  await executeProposalRetention({ ...f.dependencies, heartbeat(callback, milliseconds) { assert.equal(milliseconds, 20_000); heartbeat = callback; return () => { cancellations++; heartbeat = undefined; }; } }, await f.acquire());
  assert.equal(f.state, "SUCCEEDED"); assert.equal(maximum, 1, "renewals never overlap"); assert.equal(ticks, 8); assert.ok(cancellations > 0); assert.equal(heartbeat, undefined);
});

test("digest guard loss aborts stalled read, awaits teardown and stops before any delete intent", async () => {
  const f = retentionFixture(), plan = planProposalRetention(f.snapshot, acceptedPayload, retentionTime); plan.targets.forEach(target => f.seed(target));
  let heartbeat: (() => void) | undefined, aborted = false, closed = false, settled = false, release!: () => void;
  const closing = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => {
    f.storage.digest = async (_binding, _key, _version, _size, signal) => {
      assert.ok(signal); resolve();
      await new Promise<void>((_done, reject) => signal.addEventListener("abort", () => { aborted = true; void closing.then(() => { closed = true; reject(signal.reason); }); }, { once: true }));
      throw Error("STALLED_DIGEST_MUST_ABORT");
    };
  });
  const running = executeProposalRetention({ ...f.dependencies, heartbeat(callback) { heartbeat = callback; return () => { heartbeat = undefined; }; } }, await f.acquire());
  void running.then(() => { settled = true; }, () => { settled = true; });
  await started; f.cancel(); assert.ok(heartbeat); heartbeat(); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(aborted, true); assert.equal(settled, false, "caller must await the interrupted read teardown");
  assert.equal(f.events.some(event => event.startsWith("intent:") || event.startsWith("delete:")), false);
  release(); await assert.rejects(running, /CANCELLED/); assert.equal(closed, true); assert.equal(heartbeat, undefined);
  assert.equal(f.events.some(event => event.startsWith("intent:") || event.startsWith("delete:")), false);
});

test("retired Product copy completes only after physical absence and preserves manual production file",async()=>{
  const snapshot=retentionSnapshot(),storedName='kp-11111111-1111-4111-8111-111111111111.jpg',key='project/'+storedName;
  const source=snapshot.media[0].optimized!,copy=fact(key,source.key);
  snapshot.jobs.push({id:'copy',kind:'COPY_PRODUCT_MEDIA',state:'SUCCEEDED',attempts:1,maxAttempts:5,leaseUntil:null,result:{attached:true},
    payload:{proposalId:'proposal',projectId:'project',fileId:'file',itemId:'item',mediaId:'shared',storedName,binding:retentionBinding,optimized:copy}});
  const file={id:'file',projectId:'project',productId:'product',storedName,fileName:'image.jpg',uploadedById:'manager',hasThumb:false,
    retiredAt:retentionTime,sourceItemId:'item',sourceMediaId:'shared',copyJobId:'copy',coverReferences:0,aliases:0,pendingDelete:false};
  snapshot.files.push(file,{...file,id:'manual',storedName:'manual.jpg',retiredAt:null,sourceItemId:null,sourceMediaId:null,copyJobId:null});
  const payload={schema:1 as const,kind:'RETIRED_PRODUCT_COPY' as const,proposalId:'proposal',projectId:'project',fileId:'file',storedName,sourceMediaId:'shared',
    operationJobId:'copy',binding:retentionBinding,objects:[copy]};
  const f=retentionFixture(payload,snapshot),target=planProposalRetention(snapshot,payload,retentionTime).targets[0];
  f.seed(target,2,true);for(const version of f.objects.get(key)!)if(!version.marker)version.bytes=Buffer.from(source.key);
  f.objects.set('project/manual.jpg',[{id:'manual',marker:false,bytes:Buffer.from('production original')}]);
  await executeProposalRetention(f.dependencies,await f.acquire());
  assert.equal(f.tombstones.length,1);assert.equal(f.tombstones[0].key,key);
  assert.deepEqual(f.objects.get(key),[]);assert.equal(f.objects.get('project/manual.jpg')!.length,1);
  assert.deepEqual(snapshot.files.map(row=>row.id),['manual']);assert.equal(snapshot.versions.length,2);
});
