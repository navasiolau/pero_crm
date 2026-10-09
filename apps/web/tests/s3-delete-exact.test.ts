import assert from "node:assert/strict";
import test from "node:test";
import { DeleteObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, type S3Client } from "@aws-sdk/client-s3";
import { deleteExactS3Object } from "../src/lib/s3-delete-exact";

type Row = { Key: string; VersionId?: string; marker?: boolean };
function store(seed: Row[]) {
  const rows = [...seed], deleted: Record<string, unknown>[] = [];
  const client = { async send(command: unknown) {
    if (command instanceof ListObjectVersionsCommand) {
      const candidates = rows.filter(row => row.Key.startsWith(command.input.Prefix!));
      const start = command.input.KeyMarker
        ? candidates.findIndex(row => row.Key === command.input.KeyMarker && row.VersionId === command.input.VersionIdMarker) + 1 : 0;
      const page = candidates.slice(start, start + 2), last = page.at(-1);
      return { Versions: page.filter(row => !row.marker), DeleteMarkers: page.filter(row => row.marker),
        IsTruncated: start + 2 < candidates.length, NextKeyMarker: last?.Key, NextVersionIdMarker: last?.VersionId };
    }
    if (command instanceof DeleteObjectCommand) {
      deleted.push({ ...command.input });
      const index = rows.findIndex(row => row.Key === command.input.Key && row.VersionId === command.input.VersionId);
      if (index >= 0) rows.splice(index, 1);
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      if (rows.some(row => row.Key === command.input.Key && !row.marker)) return {};
      throw Object.assign(Error("missing"), { name: "NotFound" });
    }
    throw Error("Unexpected command");
  } } as unknown as Pick<S3Client, "send">;
  return { rows, deleted, client };
}
test("exact versioned deletion paginates versions and markers without purging a matching-prefix neighbour", async () => {
  const f = store([{ Key: "j/old.png", VersionId: "v1" }, { Key: "j/old.png", VersionId: "m1", marker: true },
    { Key: "j/old.png", VersionId: "v2" }, { Key: "j/old.png.other", VersionId: "neighbour" }]);
  await deleteExactS3Object(f.client, "crm-test", "j/old.png");
  assert.deepEqual(f.deleted.map(row => row.VersionId).sort(), ["m1", "v1", "v2"]);
  assert.ok(f.deleted.every(row => row.Bucket === "crm-test" && row.Key === "j/old.png" && row.VersionId));
  assert.deepEqual(f.rows, [{ Key: "j/old.png.other", VersionId: "neighbour" }]);
  await deleteExactS3Object(f.client, "crm-test", "j/old.png");
  assert.equal(f.deleted.length, 3, "idempotent retry does not create another marker");
});
test("unversioned null-version original is physically removed using explicit VersionId", async () => {
  const f = store([{ Key: "j/old.png", VersionId: "null" }]);
  await deleteExactS3Object(f.client, "crm-test", "j/old.png");
  assert.equal(f.deleted[0].VersionId, "null"); assert.equal(f.rows.length, 0);
});
test("invalid exact version or repeated pagination cursor stops before deleting anything", async () => {
  const f = store([{ Key: "j/old.png" }]);
  await assert.rejects(deleteExactS3Object(f.client, "crm-test", "j/old.png"), /VERSION_INVALID/);
  assert.equal(f.deleted.length, 0);
  let deletes = 0;
  const repeated = { send: async (command: unknown) => {
    if (command instanceof DeleteObjectCommand) deletes++;
    return { Versions: [{ Key: "j/old.png", VersionId: "v1" }], IsTruncated: true,
      NextKeyMarker: "j/old.png", NextVersionIdMarker: "v1" };
  } } as unknown as Pick<S3Client, "send">;
  await assert.rejects(deleteExactS3Object(repeated, "crm-test", "j/old.png"), /CURSOR_REPEATED/);
  assert.equal(deletes, 0);
});
test("a successful DELETE is not accepted when a version remains or HEAD still sees bytes", async () => {
  const f = store([{ Key: "j/old.png", VersionId: "v1" }]);
  const blocked = { send: (command: unknown) => command instanceof DeleteObjectCommand ? Promise.resolve({}) : f.client.send(command as never) } as unknown as Pick<S3Client, "send">;
  await assert.rejects(deleteExactS3Object(blocked, "crm-test", "j/old.png"), /VERSIONS_REMAIN/);
  const visible = { send: async (command: unknown) => command instanceof ListObjectVersionsCommand ? {} : {} } as unknown as Pick<S3Client, "send">;
  await assert.rejects(deleteExactS3Object(visible, "crm-test", "j/old.png"), /OBJECT_REMAINS/);
});
test("permission failure is propagated rather than replaced by marker-only deletion", async () => {
  let deletes = 0;
  const client = { send: async (command: unknown) => {
    if (command instanceof DeleteObjectCommand) deletes++;
    throw Object.assign(Error("denied"), { name: "AccessDenied" });
  } } as unknown as Pick<S3Client, "send">;
  await assert.rejects(deleteExactS3Object(client, "crm-test", "j/old.png"), { name: "AccessDenied" });
  assert.equal(deletes, 0);
});
