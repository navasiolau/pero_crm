import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { ProposalMediaError } from "../src/server/kp/media-contract";
import { ownedProposalMedia } from "../src/server/kp/media-repository";
import { proposalMediaUploadReversal } from "../src/server/kp/media-upload-reversal";

function fixture() {
  const media = { uploadState: "READY", deletedAt: null as Date | null, deletedById: null as string | null,
    originalKey: "original", optimizedKey: "optimized", proposal: { projectId: "project" } };
  let linked = false;
  const tx = {
    $queryRaw: async () => [media],
    commercialProposal: { findUnique: async () => ({ projectId: "project" }) },
    proposalMedia: {
      read: async () => media,
      findFirst: async ({ where }: { where: { deletedAt: Date | null } }) =>
        !linked && where.deletedAt?.getTime() === media.deletedAt?.getTime() ? media : null,
      update: async ({ data }: { data: { deletedAt: Date | null; deletedById: string | null } }) => Object.assign(media, data),
    },
  } as unknown as Prisma.TransactionClient;
  const command = proposalMediaUploadReversal.command({
    proposalId: "proposal", mediaId: "media", jobId: "upload", expectedDeletedAt: null, deleted: true,
  });
  const context = { tx, actor: { id: "admin", name: "Администратор", roles: ["ADMIN" as const], source: "web" as const },
    entityId: "media", entryId: "upload-entry" };
  return { media, tx, context, command, link() { linked = true; } };
}

test("reversal protects accepted media bytes and closes normal reads while hidden", async () => {
  const { media, tx, context, command } = fixture();
  const handler = proposalMediaUploadReversal.read(command.data)!;
  assert.equal(await handler.preview(context), null);
  const effect = await handler.apply(context);
  assert.ok(media.deletedAt);
  assert.equal(media.deletedById, "admin");
  await assert.rejects(ownedProposalMedia(tx, "proposal", "media"), error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_NOT_FOUND");
  assert.deepEqual([media.originalKey, media.optimizedKey], ["original", "optimized"]);
  await proposalMediaUploadReversal.read(effect.reversal.data)!.apply(context);
  assert.equal(media.deletedAt, null);
  assert.equal((await ownedProposalMedia(tx, "proposal", "media")).originalKey, "original");
});

test("reversal refuses a media upload already used by a subsequent action", async () => {
  const { media, context, command, link } = fixture();
  const handler = proposalMediaUploadReversal.read(command.data)!;
  link();
  assert.match(await handler.preview(context) ?? "", /уже используется/);
  await assert.rejects(handler.apply(context), /уже используется/);
  assert.equal(media.deletedAt, null);
});
