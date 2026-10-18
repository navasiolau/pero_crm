import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Prisma, PrismaClient } from "@prisma/client";
import { ProposalMediaError, proposalMediaExpiry, type MediaBinding } from "../../src/server/kp/media-contract";
import { prepareProposalProductMedia, readProposalMedia, uploadProposalImage } from "../../src/server/kp/media-core";
import { linkProposalProductMediaInTransaction, type ProposalMediaSaveContext } from "../../src/server/kp/media-product-sync";
import { createPrismaProposalMediaRepository } from "../../src/server/kp/media-repository";
import type { ProposalMediaStorage } from "../../src/server/kp/media-storage";

/** Координатор вызывает только после target guard внутри BEGIN/ROLLBACK. Helper не подключает БД и не вызывает S3. */
export async function verifyKpPrivateMediaNative(tx: Prisma.TransactionClient, runId: string) {
  assert.match(runId, /^[a-f0-9-]{36}$/i, "KP183_NATIVE_RUN_ID_REQUIRED");
  // SAVEPOINT сработает только внутри уже открытой транзакции, до создания любых тестовых строк.
  await tx.$executeRaw`SAVEPOINT kp183_media_native`;
  const prefix = `kp183-${runId}`, now = new Date(), checks: string[] = [];
  try {
    const managerId = prefix + "-manager", peerId = prefix + "-peer", clientId = prefix + "-client";
    const projectId = prefix + "-project", productId = prefix + "-product", proposalId = prefix + "-proposal", itemId = prefix + "-item";
    await tx.user.createMany({ data: [managerId, peerId].map((id, index) => ({ id, name: "Проверка183",
      email: `${id}@example.invalid`, passwordHash: "NATIVE183_NO_PASSWORD_LOGIN", roles: [index ? "MANAGER" as const : "ADMIN" as const] })) });
    await tx.client.create({ data: { id: clientId, name: "Синтетический клиент183", phone: "NATIVE183" } });
    let numberInt = 1_900_000_000 + parseInt(createHash("sha256").update(runId).digest("hex").slice(0, 6), 16);
    while (await tx.project.count({ where: { number: String(numberInt) } })) numberInt--;
    await tx.project.create({ data: { id: projectId, clientId, number: String(numberInt), numberInt, title: "Проверка183", stage: "LEAD" } });
    await tx.product.create({ data: { id: productId, projectId, number: `${numberInt}.1`, suffixInt: 1, title: "Изделие183", status: "DRAFT" } });
    await tx.$executeRaw`INSERT INTO "CommercialProposal" (id, "projectId", state, revision, "createdById", "createdAt", "updatedAt")
      VALUES (${proposalId}, ${projectId}, ${JSON.stringify({ items: [{ id: itemId, qty: 1 }] })}::jsonb, 4, ${managerId}, ${now}, ${now})`;
    await tx.$executeRaw`INSERT INTO "ProposalItem" (id, "proposalId", "productId", position, state, "createdAt", "updatedAt")
      VALUES (${itemId}, ${proposalId}, ${productId}, 1, ${JSON.stringify({ id: itemId, qty: 1 })}::jsonb, ${now}, ${now})`;
    const manual = await tx.file.create({ data: { projectId, productId, section: "PRODUCTION", storedName: "native183-manual.jpg",
      fileName: "Ручной производственный файл.jpg", mimeType: "image/jpeg", size: 10 } });
    await tx.product.update({ where: { id: productId }, data: { sketchFileId: manual.id } });
    await tx.project.update({ where: { id: projectId }, data: { coverFileId: manual.id } });
    const binding: MediaBinding = { endpoint: "https://native183.invalid/", bucket: "native183-unit", region: "us-east-1" };
    const objects = new Map<string, Buffer>();
    const control: { onPut?: () => Promise<void> } = {};
    const storage: ProposalMediaStorage = { currentBinding: () => binding,
      async putIfAbsent(_binding, object, bytes) {
        // Настоящая PostgreSQL-запись журнала обязана существовать до первого внешнего effect.
        const [ledger] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM "ProposalJob"
          WHERE "proposalId" = ${proposalId} AND kind = 'PURGE_MEDIA' AND payload->'objects' @> ${JSON.stringify([{ key: object.key }])}::jsonb`;
        assert.equal(ledger.count, BigInt(1)); if (objects.has(object.key)) throw Error("PreconditionFailed");
        objects.set(object.key, Buffer.from(bytes)); await control.onPut?.();
      }, async read(_binding, object) { return objects.get(object.key) ?? null; } };
    // Все короткие операции используют внешнюю guard-транзакцию; ни один тестовый write не коммитится.
    const nested = { $transaction: ((action: (transaction: Prisma.TransactionClient) => Promise<unknown>) => action(tx)) as unknown as PrismaClient["$transaction"] };
    const repository = createPrismaProposalMediaRepository(nested, { now: () => now });
    const dependencies = { repository, storage }, operation = { actorId: managerId, proposalId, expectedRevision: 4, operationId: randomUUID() };
    const original = await sharp({ create: { width: 12, height: 6, channels: 3, background: "red" } }).png().toBuffer();
    const first = await uploadProposalImage(dependencies, { ...operation, original, fileName: "Native183.png" });
    const repeated = await uploadProposalImage(dependencies, { ...operation, original, fileName: "Native183.png" });
    assert.equal(repeated.mediaId, first.mediaId); assert.equal(repeated.repeated, true);
    await assert.rejects(uploadProposalImage(dependencies, { ...operation, original, fileName: "different-name.png" }),
      error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_OPERATION_CONFLICT");
    const read = { actorId: managerId, proposalId, mediaId: first.mediaId, variant: "optimized" as const, scope: { kind: "uploaded" as const } };
    assert.ok((await readProposalMedia(dependencies, read)).bytes.length > 0);
    await assert.rejects(readProposalMedia(dependencies, { ...read, actorId: peerId }), /недоступно/);
    await assert.rejects(readProposalMedia(dependencies, { ...read, scope: { kind: "current" } }), /недоступно/);
    checks.push("native-durable-ledger-idempotency-uploaded-owner");

    // В legacy есть только оптимизированный JPEG: реальный import upload ledger без выдуманного original.
    const archiveId = prefix + "-archive", archiveMediaId = randomUUID(), archiveJobId = randomUUID(), archiveCleanupId = randomUUID();
    const [uploaded] = await tx.$queryRaw<{ optimizedKey: string; optimizedHash: string; optimizedSize: number }[]>`
      SELECT "optimizedKey","optimizedHash","optimizedSize" FROM "ProposalMedia" WHERE id=${first.mediaId}`;
    const archiveKey = `kp/proposals/${archiveId}/optimized/${archiveMediaId}.jpg`;
    const archiveObject = { key: archiveKey, sha256: uploaded.optimizedHash, size: uploaded.optimizedSize, mimeType: "image/jpeg" };
    const archivePayload = { kind: "UPLOAD_MEDIA", proposalId: archiveId, mediaId: archiveMediaId, binding, original: null,
      optimized: archiveObject, archiveImport: { manifestHash: "a".repeat(64), sourceHash: "b".repeat(64), namespace: "native183" } };
    await tx.$executeRaw`INSERT INTO "CommercialProposal"(id,"isArchive","deletedAt",state,"createdAt","updatedAt")
      VALUES(${archiveId},true,${now},'{"items":[]}'::jsonb,${now},${now})`;
    await tx.$executeRaw`INSERT INTO "ProposalJob"(id,"proposalId",kind,state,"dedupeKey",payload,attempts,"leaseOwner","leaseUntil","createdById","createdAt","updatedAt")
      VALUES(${archiveJobId},${archiveId},'UPLOAD_MEDIA','PROCESSING',${"native183:archive:"+archiveMediaId},${JSON.stringify(archivePayload)}::jsonb,1,
      ${runId},${new Date(now.getTime()+300_000)},${managerId},${now},${now})`;
    await tx.$executeRaw`INSERT INTO "ProposalJob"(id,"proposalId",kind,"dedupeKey",payload,"availableAt","createdAt","updatedAt")
      VALUES(${archiveCleanupId},${archiveId},'PURGE_MEDIA',${"native183:archive-cleanup:"+archiveMediaId},
      ${JSON.stringify({ schema: 1, kind: "UNATTACHED_MEDIA", proposalId: archiveId, projectId: null, mediaId: archiveMediaId,
        operationJobId: archiveJobId, binding, objects: [archiveObject] })}::jsonb,${new Date(now.getTime()+24*3600_000)},${now},${now})`;
    await tx.$executeRaw`INSERT INTO "ProposalMedia"(id,"proposalId","storageBinding","optimizedKey","optimizedHash","optimizedSize",
      "mimeType","optimizedMimeType","fileName","expiresAt","uploadState","uploadJobId") VALUES(${archiveMediaId},${archiveId},${JSON.stringify(binding)}::jsonb,
      ${archiveKey},${uploaded.optimizedHash},${uploaded.optimizedSize},'image/jpeg','image/jpeg','Legacy183.jpg',${proposalMediaExpiry(now)},'PENDING',${archiveJobId})`;
    objects.set(archiveKey, Buffer.from(objects.get(uploaded.optimizedKey)!));
    assert.equal(createHash("sha256").update(objects.get(archiveKey)!).digest("hex"), uploaded.optimizedHash);
    await tx.$executeRaw`UPDATE "ProposalJob" SET state='SUCCEEDED',"leaseOwner"=NULL,"leaseUntil"=NULL WHERE id=${archiveJobId}`;
    await tx.$executeRaw`UPDATE "ProposalMedia" SET "uploadState"='READY' WHERE id=${archiveMediaId}`;
    const [archiveMedia] = await tx.$queryRaw<{ originalKey: string | null; optimizedHash: string; uploadState: string }[]>`SELECT "originalKey","optimizedHash","uploadState" FROM "ProposalMedia" WHERE id=${archiveMediaId}`;
    assert.equal(archiveMedia.originalKey, null); assert.equal(archiveMedia.uploadState, "READY");
    await tx.$executeRaw`SAVEPOINT kp183_archive_bad_hash`;
    let archiveBadHash = false;
    try { await tx.$executeRaw`UPDATE "ProposalMedia" SET "optimizedHash"=${"e".repeat(64)} WHERE id=${archiveMediaId}`; }
    catch (error) { archiveBadHash = error instanceof Error && error.message.includes("KP_MEDIA_UPLOAD_OWNER_MISMATCH"); }
    finally { await tx.$executeRaw`ROLLBACK TO SAVEPOINT kp183_archive_bad_hash`; await tx.$executeRaw`RELEASE SAVEPOINT kp183_archive_bad_hash`; }
    assert.equal(archiveBadHash, true);
    checks.push("native-optimized-only-archive-real-upload-ledger-and-hash-guard");

    const state = { items: [{ id: itemId, image: first.reference }] };
    const prepared = await prepareProposalProductMedia(dependencies, { ...operation, operationId: randomUUID(), ...state });
    const context: ProposalMediaSaveContext = { actor: { id: managerId, name: "Проверка183", source: "api" }, proposalId,
      proposal: { revision: 4 }, project: { id: projectId }, state, items: [{ id: itemId, productId }] };
    assert.equal((await linkProposalProductMediaInTransaction(tx, context, { storage, preparedCopies: prepared, now })).changed, true);
    const [firstCopy] = await tx.$queryRaw<{ id: string; storedName: string; proposalMediaRetiredAt: Date | null }[]>`
      SELECT * FROM "File" WHERE "proposalSourceMediaId" = ${first.mediaId}`;
    assert.ok(firstCopy.storedName.startsWith("kp-")); assert.ok(objects.has(`${projectId}/${firstCopy.storedName}`));
    assert.equal((await tx.product.findUniqueOrThrow({ where: { id: productId } })).sketchFileId, manual.id);
    assert.equal((await tx.project.findUniqueOrThrow({ where: { id: projectId } })).coverFileId, manual.id);
    assert.equal((await linkProposalProductMediaInTransaction(tx, context, { storage, now })).changed, false);
    await readProposalMedia(dependencies, { ...read, actorId: peerId, scope: { kind: "current" } });
    checks.push("native-atomic-current-links-independent-copy-manual-cover-preserved");

    await tx.$executeRaw`SAVEPOINT kp183_invalid_file`;
    let invalidFile = false;
    try { await tx.$executeRaw`UPDATE "File" SET "storedName" = 'kp-forged.jpg' WHERE id = ${firstCopy.id}`; }
    catch (error) { invalidFile = error instanceof Error && error.message.includes("KP_MANAGED_FILE_OWNER_MISMATCH"); }
    finally { await tx.$executeRaw`ROLLBACK TO SAVEPOINT kp183_invalid_file`; await tx.$executeRaw`RELEASE SAVEPOINT kp183_invalid_file`; }
    assert.equal(invalidFile, true, "managed File path is fenced by native trigger");
    await tx.$executeRaw`SAVEPOINT kp183_invalid_media`;
    let invalidMedia = false;
    try { await tx.$executeRaw`UPDATE "ProposalMedia" SET "optimizedHash" = ${"b".repeat(64)} WHERE id = ${first.mediaId}`; }
    catch (error) { invalidMedia = error instanceof Error && error.message.includes("KP_MEDIA_UPLOAD_OWNER_MISMATCH"); }
    finally { await tx.$executeRaw`ROLLBACK TO SAVEPOINT kp183_invalid_media`; await tx.$executeRaw`RELEASE SAVEPOINT kp183_invalid_media`; }
    assert.equal(invalidMedia, true, "media variants cannot be rebound to unrelated bytes");
    checks.push("native-managed-file-path-and-media-variant-owner-constraints");

    await tx.product.update({ where: { id: productId }, data: { sketchFileId: firstCopy.id } });
    const second = await uploadProposalImage(dependencies, { ...operation, operationId: randomUUID(), original, fileName: "Second.png" });
    const nextState = { items: [{ id: itemId, image: second.reference }] };
    const nextPrepared = await prepareProposalProductMedia(dependencies, { ...operation, operationId: randomUUID(), ...nextState });
    await linkProposalProductMediaInTransaction(tx, { ...context, state: nextState }, { storage, preparedCopies: nextPrepared, now });
    const [retired] = await tx.$queryRaw<{ proposalMediaRetiredAt: Date | null }[]>`SELECT "proposalMediaRetiredAt" FROM "File" WHERE id = ${firstCopy.id}`;
    assert.ok(retired.proposalMediaRetiredAt);
    assert.notEqual((await tx.product.findUniqueOrThrow({ where: { id: productId } })).sketchFileId, firstCopy.id);
    const [retireJob] = await tx.$queryRaw<{ payload: { objects: { key: string }[]; fileId: string } }[]>`SELECT payload FROM "ProposalJob"
      WHERE "proposalId" = ${proposalId} AND payload->>'kind' = 'RETIRED_PRODUCT_COPY' AND payload->>'fileId' = ${firstCopy.id}`;
    assert.equal(retireJob.payload.fileId, firstCopy.id);
    assert.deepEqual(retireJob.payload.objects.map(object => object.key), [`${projectId}/${firstCopy.storedName}`]);
    assert.ok(await tx.file.findUnique({ where: { id: manual.id } }));
    for (const key of [...objects.keys()]) if (key.startsWith("kp/")) objects.delete(key);
    const [activeCopy] = await tx.$queryRaw<{ storedName: string }[]>`SELECT "storedName" FROM "File"
      WHERE "proposalSourceMediaId" = ${second.mediaId} AND "proposalMediaRetiredAt" IS NULL`;
    assert.ok(objects.has(`${projectId}/${activeCopy.storedName}`));
    checks.push("native-retirement-exact-intent-product-copy-survives-kp-purge");

    await tx.$executeRaw`UPDATE "CommercialProposal" SET "createdAt" = ${new Date("2000-01-01T00:00:00Z")} WHERE id = ${proposalId}`;
    await tx.$executeRaw`UPDATE "ProposalMedia" SET "expiresAt" = ${new Date("2001-01-01T00:00:00Z")},
      "originalPurgedAt" = ${now}, "optimizedPurgedAt" = ${now}, "retiringAt" = ${now} WHERE "proposalId" = ${proposalId}`;
    const beforeExpiredUpload = objects.size;
    await assert.rejects(uploadProposalImage(dependencies, { ...operation, operationId: randomUUID(), original, fileName: "Too-old.png" }),
      error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_EXPIRED");
    assert.equal(objects.size, beforeExpiredUpload);
    const oldPrepared = await prepareProposalProductMedia(dependencies, { ...operation, operationId: randomUUID(), ...nextState });
    assert.deepEqual(oldPrepared.jobs, []);
    assert.equal((await linkProposalProductMediaInTransaction(tx, { ...context, state: nextState }, { storage, preparedCopies: oldPrepared, now })).changed, false);
    await linkProposalProductMediaInTransaction(tx, { ...context, state: { items: [{ id: itemId }] } }, { storage, now });
    await tx.$executeRaw`UPDATE "CommercialProposal" SET "createdAt" = ${now} WHERE id = ${proposalId}`;
    checks.push("native-expired-source-text-save-reuses-independent-file-upload-rejected-before-storage");

    control.onPut = async () => { await tx.project.update({ where: { id: projectId }, data: { stage: "ESTIMATE" } }); };
    await assert.rejects(uploadProposalImage(dependencies, { ...operation, operationId: randomUUID(), original, fileName: "Locked.png" }),
      error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_LOCKED");
    const [pending] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM "ProposalMedia" WHERE "proposalId" = ${proposalId} AND "uploadState" = 'PENDING'`;
    assert.equal(pending.count, BigInt(1));
    assert.equal((await tx.file.count({ where: { projectId } })), 3);
    checks.push("native-stage-revocation-before-publish-leaves-pending-ledger");
    return checks;
  } finally {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT kp183_media_native`;
    await tx.$executeRaw`RELEASE SAVEPOINT kp183_media_native`;
  }
}
