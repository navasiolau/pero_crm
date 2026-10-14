import assert from "node:assert/strict";
import test from "node:test";
import { DeleteObjectCommand, ListObjectVersionsCommand, type S3Client } from "@aws-sdk/client-s3";
import { deleteExactS3Object } from "../src/lib/s3-delete-exact";

test("invalid version or repeated pagination cursor refuses before any DeleteObject", async () => {
  for (const mode of ["version", "cursor"] as const) {
    let deletes = 0;
    const client = { send: async (command: unknown) => {
      if (command instanceof DeleteObjectCommand) { deletes++; return {}; }
      assert.ok(command instanceof ListObjectVersionsCommand);
      return { Versions: [{ Key: "owned/file.pdf", ...(mode === "cursor" ? { VersionId: "v1" } : {}) }],
        IsTruncated: mode === "cursor", NextKeyMarker: "owned/file.pdf", NextVersionIdMarker: "v1" };
    } } as unknown as Pick<S3Client, "send">;
    await assert.rejects(deleteExactS3Object(client, "ci-owned", "owned/file.pdf"), mode === "version" ? /VERSION_INVALID/ : /CURSOR_REPEATED/);
    assert.equal(deletes, 0);
  }
});
