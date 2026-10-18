import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { imageMimeFromBytes } from "../media-contract";
import { ArchiveImportError, archiveAssert, byteHash, canonical, jsonClone, parseSourceProfile, valueHash, type ArchiveSource } from "./contract";
import { parseArchiveRecoveryMap, recoveryProvenance, type ArchiveRecoveryEntry } from "./recovery-contract";

const comparablePath = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
async function boundedFile(root: string, entry: ArchiveRecoveryEntry): Promise<string> {
  const directory = resolve(root), file = resolve(directory, entry.file), chain: string[] = [];
  for (let path = directory; ; path = dirname(path)) { chain.unshift(path); if (path === parse(path).root) break; }
  for (const path of chain) {
    const info = await lstat(path);
    archiveAssert(info.isDirectory() && !info.isSymbolicLink(), "ARCHIVE_RECOVERY_PATH_INVALID");
  }
  archiveAssert(comparablePath(await realpath(directory)) === comparablePath(directory) && dirname(file) === directory, "ARCHIVE_RECOVERY_PATH_INVALID");
  const info = await lstat(file);
  archiveAssert(info.isFile() && !info.isSymbolicLink() && comparablePath(await realpath(file)) === comparablePath(file), "ARCHIVE_RECOVERY_PATH_INVALID");
  return file;
}

async function recoveredBytes(root: string, entry: ArchiveRecoveryEntry, limit: number): Promise<Buffer> {
  archiveAssert(Number.isSafeInteger(limit) && limit > 0 && limit <= 128 * 1024 * 1024 && entry.size <= limit, "ARCHIVE_SOURCE_SIZE_INVALID");
  try {
    const file = await boundedFile(root, entry);
    const handle = await open(file, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    try {
      const before = await handle.stat({ bigint: true });
      archiveAssert(before.isFile() && before.size === BigInt(entry.size), "ARCHIVE_RECOVERY_BYTES_MISMATCH");
      const bytes = Buffer.alloc(entry.size + 1); let size = 0;
      while (size < bytes.length) {
        const read = await handle.read(bytes, size, bytes.length - size, size); if (!read.bytesRead) break; size += read.bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      await boundedFile(root, entry);
      const current = await lstat(file, { bigint: true });
      archiveAssert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs &&
        current.dev === after.dev && current.ino === after.ino && current.size === after.size && size === entry.size, "ARCHIVE_RECOVERY_BYTES_MISMATCH");
      const result = bytes.subarray(0, size);
      archiveAssert(byteHash(result) === entry.sha256, "ARCHIVE_RECOVERY_BYTES_MISMATCH");
      let mime: string; try { mime = imageMimeFromBytes(result); } catch { throw new ArchiveImportError("ARCHIVE_RECOVERY_MIME_MISMATCH"); }
      archiveAssert(mime === entry.mimeType, "ARCHIVE_RECOVERY_MIME_MISMATCH");
      return result;
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof ArchiveImportError) throw error;
    throw new ArchiveImportError("ARCHIVE_RECOVERY_FILE_UNAVAILABLE");
  }
}

/** Сначала настоящий GET. Замена разрешена только после нормализованного NoSuchKey/NotFound+404. LIST не подменяется. */
export function createRecoveryArchiveSource(cloud: ArchiveSource, input: unknown, root: string): ArchiveSource {
  archiveAssert(typeof root === "string" && root.trim().length > 0, "ARCHIVE_RECOVERY_ROOT_REQUIRED");
  const profile = parseSourceProfile(cloud.profile()), map = parseArchiveRecoveryMap(input, profile), directory = resolve(root);
  const entries = new Map(map.entries.map(row => [row.key, row]));
  const assertProfile = () => archiveAssert(valueHash(parseSourceProfile(cloud.profile())) === map.sourceNamespace, "ARCHIVE_SOURCE_BINDING_CHANGED");
  return {
    profile: () => { assertProfile(); return jsonClone(profile); },
    recoveryMap: () => jsonClone(map),
    async list(area, prefix) { assertProfile(); const values = await cloud.list(area, prefix); assertProfile(); return values; },
    async read(area, key, maxBytes) {
      assertProfile(); const entry = area === "public" ? entries.get(key) : undefined;
      try {
        const actual = await cloud.read(area, key, maxBytes); assertProfile();
        archiveAssert(!entry, "ARCHIVE_RECOVERY_SOURCE_REAPPEARED");
        archiveAssert(!actual.recovery, "ARCHIVE_RECOVERY_MAP_MISMATCH"); return actual;
      } catch (error) {
        if (!(error instanceof ArchiveImportError && error.code === "ARCHIVE_SOURCE_MISSING") || !entry) throw error;
      }
      const bytes = await recoveredBytes(directory, entry, maxBytes); assertProfile();
      archiveAssert(canonical(map.sourceProfile) === canonical(profile), "ARCHIVE_RECOVERY_BINDING_MISMATCH");
      return { bytes, mimeType: entry.mimeType, modifiedAt: null, recovery: recoveryProvenance(map, entry) };
    },
  };
}
