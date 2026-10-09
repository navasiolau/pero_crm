import { DeleteObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, type S3Client } from "@aws-sdk/client-s3";

type Client = Pick<S3Client, "send">;

async function exactVersions(client: Client, bucket: string, key: string) {
  const versions = new Set<string>();
  const cursors = new Set<string>();
  let keyMarker: string | undefined, versionMarker: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await client.send(new ListObjectVersionsCommand({
      Bucket: bucket, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionMarker,
    }));
    for (const row of [...(result.Versions ?? []), ...(result.DeleteMarkers ?? [])]) {
      if (row.Key !== key) continue;
      if (!row.VersionId) throw Error("S3_EXACT_VERSION_INVALID");
      versions.add(row.VersionId);
    }
    if (!result.IsTruncated) return [...versions];
    const nextKey = result.NextKeyMarker, nextVersion = result.NextVersionIdMarker;
    if (!nextKey || (!nextVersion && nextKey === key)) throw Error("S3_EXACT_CURSOR_INVALID");
    const cursor = JSON.stringify([nextKey, nextVersion]);
    if (cursors.has(cursor)) throw Error("S3_EXACT_CURSOR_REPEATED");
    cursors.add(cursor); keyMarker = nextKey; versionMarker = nextVersion;
  }
  throw Error("S3_EXACT_PAGE_LIMIT");
}

/** Удаляет только один exact key, включая версии и markers; Prefix не является областью удаления. */
export async function deleteExactS3Object(client: Client, bucket: string, key: string): Promise<void> {
  if (!bucket || !key) throw Error("S3_EXACT_TARGET_INVALID");
  const versions = await exactVersions(client, bucket, key);
  for (const versionId of versions) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
  }
  if ((await exactVersions(client, bucket, key)).length !== 0) throw Error("S3_EXACT_VERSIONS_REMAIN");
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NotFound" || name === "NoSuchKey") return;
    throw error;
  }
  throw Error("S3_EXACT_OBJECT_REMAINS");
}
