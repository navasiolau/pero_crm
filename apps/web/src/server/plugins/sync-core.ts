export type PluginSyncManifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  permissions: string[];
};

type StoredPluginMetadata = Pick<PluginSyncManifest, "name" | "version" | "apiVersion" | "permissions"> & {
  description: string | null;
};

export type PluginSyncStore = {
  findUnique(args: {
    where: { id: string };
    select: { name: true; version: true; apiVersion: true; description: true; permissions: true };
  }): Promise<StoredPluginMetadata | null>;
  upsert(args: {
    where: { id: string };
    create: StoredPluginMetadata & { id: string };
    update: StoredPluginMetadata;
  }): Promise<unknown>;
};

function matches(current: StoredPluginMetadata, manifest: PluginSyncManifest): boolean {
  const permissionsMatch = current.permissions.length === manifest.permissions.length &&
    current.permissions.every((permission, index) => permission === manifest.permissions[index]);
  return current.name === manifest.name &&
    current.version === manifest.version &&
    current.apiVersion === manifest.apiVersion &&
    current.description === (manifest.description ?? null) &&
    permissionsMatch;
}

export async function syncPluginMetadata(
  store: PluginSyncStore,
  manifest: PluginSyncManifest,
): Promise<"unchanged" | "created" | "updated"> {
  const where = { id: manifest.id };
  const current = await store.findUnique({ where, select: {
    name: true, version: true, apiVersion: true, description: true, permissions: true,
  } });
  if (current && matches(current, manifest)) return "unchanged";

  const metadata: StoredPluginMetadata = {
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    description: manifest.description ?? null,
    permissions: manifest.permissions,
  };
  await store.upsert({ where, create: { id: manifest.id, ...metadata }, update: metadata });
  return current ? "updated" : "created";
}
