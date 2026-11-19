import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { Prisma } from "@prisma/client";
import { assertWritableFileStorageKey } from "@/server/files/storage-binding-fence";
import { ProposalMediaError, itemMediaReferences, sameMediaBinding, validateMediaPlan,
  type MediaPlan, type PreparedProductMedia } from "./media-contract";
import { lockProposalMediaOwner, ownedProposalMedia, readableMedia, type OwnedMediaRow } from "./media-repository";
import { assertMediaStorageBinding, type ProposalMediaStorage } from "./media-storage";
import type {JournalPresentationHints} from '@/server/changelog/contract';
import {automationJournalContext,productJournalContext,projectJournalContext} from '../projects/journal';

type Tx = Prisma.TransactionClient;
export type ProposalMediaSaveContext = {
  actor: { id: string; name: string; source: "web" | "telegram" | "api" };
  proposalId: string;
  operationRootId?: string;
  proposal: { revision: number };
  project: { id: string };
  state: { items: readonly { id: string; image?: unknown; image2?: unknown }[] };
  items: readonly { id: string; productId: string }[];
};
type ManagedFile = { id: string; projectId: string; productId: string | null; storedName: string;
  fileName: string; proposalSourceItemId: string | null; proposalSourceMediaId: string | null;
  proposalMediaCopyJobId: string | null; proposalMediaRetiredAt: Date | null; storageAvailability: string | null; payload: unknown };
type PreparedJob = { id: string; kind: string; state: string; proposalId: string | null;
  createdById: string | null; payload: unknown; result: unknown };

async function audit(tx: Tx, context: ProposalMediaSaveContext, entity: string, entityId: string, action: string, newValue: Prisma.InputJsonObject,hints:JournalPresentationHints) {
  await writeChangeLogInTransaction(tx, { actorType: "user", actorId: context.actor.id, actorName: context.actor.name,
    source: context.actor.source, operationRootId: context.operationRootId, entity, entityId, action, newValue },
    {...hints,...automationJournalContext(context.actor,'Синхронизация изображений из КП')});
}
async function cancelUnattachedCleanup(tx: Tx, plan: MediaPlan, now: Date) {
  const [cleanup] = await tx.$queryRaw<{ state: string }[]>`SELECT state FROM "ProposalJob" WHERE id = ${plan.cleanupJobId} FOR UPDATE`;
  if (!cleanup || (plan.kind === "COPY_PRODUCT_MEDIA" && ["PROCESSING", "SUCCEEDED"].includes(cleanup.state)))
    throw new ProposalMediaError("KP_MEDIA_OPERATION_CONFLICT");
  if (cleanup.state === "SUCCEEDED" || cleanup.state === "CANCELLED") return;
  await tx.$executeRaw`UPDATE "ProposalJob" SET state = 'CANCELLED', "leaseOwner" = NULL, "leaseUntil" = NULL,
    "updatedAt" = ${now} WHERE id = ${plan.cleanupJobId}`;
}
async function readPreparedPlan(tx: Tx, jobId: string, context: ProposalMediaSaveContext): Promise<MediaPlan> {
  const [job] = await tx.$queryRaw<PreparedJob[]>`SELECT * FROM "ProposalJob" WHERE id = ${jobId} FOR UPDATE`;
  if (!job || job.kind !== "COPY_PRODUCT_MEDIA" || job.state !== "SUCCEEDED" || job.proposalId !== context.proposalId ||
    job.createdById !== context.actor.id) throw new ProposalMediaError("KP_MEDIA_COPY_REQUIRED");
  const plan = validateMediaPlan(job.payload);
  if (plan.kind !== "COPY_PRODUCT_MEDIA" || plan.proposalId !== context.proposalId || plan.projectId !== context.project.id ||
    plan.actorId !== context.actor.id || plan.expectedRevision !== context.proposal.revision)
    throw new ProposalMediaError("KP_MEDIA_COPY_REQUIRED");
  return plan;
}

/** Без S3 I/O: атомарно вызывается внутри общей №181 save transaction перед CAS ревизии. */
export async function linkProposalProductMediaInTransaction(tx: Tx, context: ProposalMediaSaveContext, options: {
  storage: Pick<ProposalMediaStorage, "currentBinding">; preparedCopies?: PreparedProductMedia; now?: Date;
}): Promise<{ changed: boolean }> {
  const now = options.now ?? new Date();
  const owner = await lockProposalMediaOwner(tx, { actorId: context.actor.id, proposalId: context.proposalId,
    expectedRevision: context.proposal.revision }, true);
  if (owner.projectId !== context.project.id) throw new ProposalMediaError("KP_MEDIA_REVISION_CONFLICT");
  const references = itemMediaReferences(context.state.items), products = new Map(context.items.map(item => [item.id, item.productId]));
  if (products.size !== references.length || references.some(item => !products.has(item.itemId))) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  const prepared = options.preparedCopies;
  if (prepared && (prepared.proposalId !== context.proposalId || prepared.expectedRevision !== context.proposal.revision ||
    new Set(prepared.jobs).size !== prepared.jobs.length)) throw new ProposalMediaError("KP_MEDIA_COPY_REQUIRED");
  const plans = new Map<string, MediaPlan>();
  for (const jobId of prepared?.jobs ?? []) {
    const plan = await readPreparedPlan(tx, jobId, context);
    assertMediaStorageBinding(options.storage, plan.binding);
    if (!references.some(item => item.itemId === plan.itemId && item.mediaIds.includes(plan.mediaId)))
      throw new ProposalMediaError("KP_MEDIA_COPY_REQUIRED");
    plans.set(`${plan.itemId}\0${plan.mediaId}`, plan);
  }
  const managed = await tx.$queryRaw<ManagedFile[]>`
    SELECT f.*, j.payload, j.result->>'storageAvailability' AS "storageAvailability" FROM "File" f JOIN "ProposalJob" j ON j.id = f."proposalMediaCopyJobId"
    WHERE f."projectId" = ${context.project.id} AND j."proposalId" = ${context.proposalId} AND f."deletedAt" IS NULL
    ORDER BY f."proposalMediaRetiredAt" NULLS FIRST, f."createdAt", f.id FOR UPDATE OF f`;
  const previous = await tx.$queryRaw<{ mediaId: string }[]>`SELECT "mediaId" FROM "ProposalCurrentMedia" WHERE "proposalId" = ${context.proposalId} AND "detachedAt" IS NULL`;
  const previousMediaIds = new Set(previous.map(row => row.mediaId));
  const fileNames=new Map(managed.map(file=>[file.id,file.fileName]));
  const retained = new Set<string>(), mediaIds = new Set<string>(); let changed = false;
  for (const item of references) {
    const productId = products.get(item.itemId)!;
    const [product] = await tx.$queryRaw<{ id: string; number:string; sketchFileId: string | null }[]>`
      SELECT id, number, "sketchFileId" FROM "Product" WHERE id = ${productId} AND "projectId" = ${context.project.id} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!product) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
    let cover: string | null = null;
    for (const mediaId of item.mediaIds) {
      let file = managed.find(candidate => candidate.proposalSourceItemId === item.itemId && candidate.proposalSourceMediaId === mediaId &&
        candidate.productId === productId && candidate.storageAvailability !== "UNAVAILABLE" && candidate.storageAvailability !== "UNVERIFIED");
      let media: OwnedMediaRow, source: ReturnType<typeof readableMedia> | undefined;
      if (file) {
        const [stored] = await tx.$queryRaw<OwnedMediaRow[]>`SELECT * FROM "ProposalMedia" WHERE id = ${mediaId} AND "proposalId" = ${context.proposalId}`;
        if (!stored || stored.uploadState !== "READY" || stored.deletedAt ||
          (!previousMediaIds.has(mediaId) && (stored.retiringAt || stored.optimizedPurgedAt)))
          throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
        media = stored;
        const existingPlan = validateMediaPlan(file.payload);
        if (existingPlan.kind !== "COPY_PRODUCT_MEDIA" || existingPlan.fileId !== file.id || existingPlan.mediaId !== mediaId ||
          existingPlan.itemId !== item.itemId || existingPlan.projectId !== context.project.id || existingPlan.proposalId !== context.proposalId)
          throw new ProposalMediaError("KP_MEDIA_INVALID");
        assertMediaStorageBinding(options.storage, existingPlan.binding);
      } else {
        media = await ownedProposalMedia(tx, context.proposalId, mediaId); source = readableMedia(media, "optimized");
        assertMediaStorageBinding(options.storage, source.binding);
      }
      mediaIds.add(mediaId);
      if (!file) {
        const plan = plans.get(`${item.itemId}\0${mediaId}`);
        if (!source || !plan?.fileId || !plan.storedName || !plan.source || plan.source.key !== source.object.key ||
          plan.source.sha256 !== source.object.sha256 || plan.source.size !== source.object.size ||
          !sameMediaBinding(plan.binding, source.binding)) throw new ProposalMediaError("KP_MEDIA_COPY_REQUIRED");
        await cancelUnattachedCleanup(tx, plan, now);
        await assertWritableFileStorageKey(tx, context.project.id, plan.storedName);
        const extension = plan.storedName.slice(plan.storedName.lastIndexOf("."));
        const fileName = (plan.fileName.replace(/\.[^.]+$/, "") || "image") + extension;
        await tx.$executeRaw`INSERT INTO "File" (id, "projectId", "productId", section, "fileName", "storedName", "mimeType", size,
          "hasThumb", "uploadedById", "proposalSourceItemId", "proposalSourceMediaId", "proposalMediaCopyJobId", "createdAt") VALUES
          (${plan.fileId}, ${context.project.id}, ${productId}, 'PRODUCTION', ${fileName}, ${plan.storedName}, ${plan.optimized.mimeType},
          ${plan.optimized.size}, false, ${context.actor.id}, ${item.itemId}, ${mediaId}, ${plan.jobId}, ${now})`;
        await tx.$executeRaw`UPDATE "ProposalJob" SET result = ${JSON.stringify({ fileId: plan.fileId, copyReady: true, attached: true })}::jsonb,
          "updatedAt" = ${now} WHERE id = ${plan.jobId}`;
        file = { id: plan.fileId, projectId: context.project.id, productId, storedName: plan.storedName, fileName,
          proposalSourceItemId: item.itemId, proposalSourceMediaId: mediaId, proposalMediaCopyJobId: plan.jobId,
          proposalMediaRetiredAt: null, storageAvailability: null, payload: plan };
        await audit(tx, context, "file", file.id, "create", { proposalId: context.proposalId, sourceMediaId: mediaId,
          sourceItemId: item.itemId, fileName, section: "PRODUCTION", contentHash: plan.optimized.sha256 },
          {...productJournalContext(product),entity:{type:'file',id:file.id,label:fileName},before:null,
            after:{fileName,section:'PRODUCTION',mimeType:plan.optimized.mimeType,size:plan.optimized.size}});
        changed = true;
      } else if (file.proposalMediaRetiredAt) {
        const retiredAt = file.proposalMediaRetiredAt;
        await tx.file.update({ where: { id: file.id, deletedAt: null, proposalMediaRetiredAt: retiredAt },
          data: { proposalMediaRetiredAt: null } });
        await audit(tx, context, "file", file.id, "restore",
          { proposalId: context.proposalId, sourceMediaId: mediaId, sourceItemId: item.itemId },
          { ...productJournalContext(product), entity: { type: "file", id: file.id, label: file.fileName },
            before: { retiredAt: retiredAt.toISOString() }, after: { retiredAt: null } });
        changed = true;
      }
      fileNames.set(file.id,file.fileName);
      retained.add(file.id); cover ??= file.id;
      if (!previousMediaIds.has(mediaId) && media.uploadJobId) {
        const [upload] = await tx.$queryRaw<{ payload: unknown }[]>`SELECT payload FROM "ProposalJob" WHERE id = ${media.uploadJobId} FOR UPDATE`;
        if (!upload) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
        await cancelUnattachedCleanup(tx, validateMediaPlan(upload.payload), now);
      }
    }
    const managedCover = managed.some(file => file.id === product.sketchFileId && file.productId === productId);
    if ((product.sketchFileId === null || managedCover) && product.sketchFileId !== cover) {
      await tx.product.update({ where: { id: product.id }, data: { sketchFileId: cover } });
      await audit(tx, context, "product", product.id, "kp.cover", { proposalId: context.proposalId,
        previousFileId: product.sketchFileId, sketchFileId: cover },
        {...productJournalContext(product),before:{sketchFileId:product.sketchFileId},after:{sketchFileId:cover},
          links:[product.sketchFileId,cover].flatMap(id=>id&&fileNames.has(id)?[{type:'file',id,label:fileNames.get(id)!}]:[])}); changed = true;
    }
  }
  for (const file of managed) {
    if (retained.has(file.id) || file.proposalMediaRetiredAt) continue;
    const plan = validateMediaPlan(file.payload);
    if (plan.kind !== "COPY_PRODUCT_MEDIA" || plan.fileId !== file.id || plan.storedName !== file.storedName ||
      plan.proposalId !== context.proposalId || plan.projectId !== context.project.id) throw new ProposalMediaError("KP_MEDIA_INVALID");
    assertMediaStorageBinding(options.storage, plan.binding);
    // Чужие/manual обложки не трогаем. Удалённая позиция больше не держит собственную старую управляемую обложку.
    const product=file.productId?await tx.product.findUnique({where:{id:file.productId},select:{id:true,number:true}}):null;
    if (file.productId) {
      const cleared=await tx.product.updateMany({ where: { id: file.productId, sketchFileId: file.id }, data: { sketchFileId: null } });
      if(cleared.count)await audit(tx,context,'product',file.productId,'kp.cover',{proposalId:context.proposalId,previousFileId:file.id,sketchFileId:null},
        {...productJournalContext(product??{id:file.productId}),before:{sketchFileId:file.id},after:{sketchFileId:null},links:[{type:'file',id:file.id,label:file.fileName}]});
    }
    await tx.$executeRaw`UPDATE "File" SET "proposalMediaRetiredAt" = ${now} WHERE id = ${file.id} AND "proposalMediaRetiredAt" IS NULL`;
    await audit(tx, context, "file", file.id, "kp.retire", { proposalId: context.proposalId, sourceItemId: file.proposalSourceItemId,
      sourceMediaId: file.proposalSourceMediaId, retiredAt: now.toISOString() },
      {...(file.productId?productJournalContext(product??{id:file.productId}):projectJournalContext(context.project)),entity:{type:'file',id:file.id,label:file.fileName},
        before:{fileName:file.fileName,retiredAt:null},after:{fileName:file.fileName,retiredAt:now.toISOString()}}); changed = true;
  }
  if (previous.length !== mediaIds.size || previous.some(row => !mediaIds.has(row.mediaId))) {
    const detached = previous.map(row => row.mediaId).filter(id => !mediaIds.has(id));
    if (detached.length) await tx.proposalCurrentMedia.updateMany({
      where: { proposalId: context.proposalId, mediaId: { in: detached }, detachedAt: null },
      data: { detachedAt: now },
    });
    for (const mediaId of mediaIds) {
      if (previousMediaIds.has(mediaId)) continue;
      await tx.$executeRaw`INSERT INTO "ProposalCurrentMedia" ("proposalId", "mediaId") VALUES (${context.proposalId}, ${mediaId})
        ON CONFLICT ("proposalId", "mediaId") DO UPDATE SET "detachedAt"=NULL`;
    }
    changed = true;
  }
  return { changed };
}

export function createProposalMediaHooks(options: {
  storage: Pick<ProposalMediaStorage, "currentBinding">; preparedCopies?: PreparedProductMedia; now?: () => Date;
}) {
  return { applyMedia: (tx: Tx, context: ProposalMediaSaveContext) =>
    linkProposalProductMediaInTransaction(tx, context, { ...options, now: options.now?.() }) };
}
