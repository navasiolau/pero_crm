import { createRequire, Module, syncBuiltinESMExports } from "node:module";

type Exports = Record<string, unknown>;
type Patch = { object: object; key: PropertyKey; before: PropertyDescriptor | undefined; installed: PropertyDescriptor };
type Options = { targets: readonly string[]; allowedOverrides: readonly string[]; overrides: Record<string, Exports>; prisma: object };
let activeOwner: symbol | undefined;
const sameDescriptor = (a: PropertyDescriptor | undefined, b: PropertyDescriptor | undefined) =>
  a?.value === b?.value && a?.get === b?.get && a?.set === b?.set && a?.writable === b?.writable && a?.enumerable === b?.enumerable && a?.configurable === b?.configurable;

/** Одна CJS-фикстура на сценарий. Реальные target modules и Decimal не заменяются. */
export function guardedModuleCache(ownerUrl: string, options: Options) {
  if (activeOwner) throw new Error("FIXTURE_SCOPE_ALREADY_ACTIVE");
  const require = createRequire(ownerUrl);
  const resolveList = (values: readonly string[]) => {
    const resolved = new Map(values.map(value => [value, require.resolve(value)]));
    if (resolved.size !== values.length || new Set(resolved.values()).size !== values.length) throw new Error("FIXTURE_DUPLICATE_PATH");
    return resolved;
  };
  const targets = resolveList(options.targets), allowed = resolveList(options.allowedOverrides);
  for (const key of Object.keys(options.overrides)) if (!allowed.has(key)) throw new Error("FIXTURE_OVERRIDE_NOT_ALLOWED");
  if (Object.keys(options.overrides).length !== allowed.size) throw new Error("FIXTURE_OVERRIDE_REQUIRED");
  const prismaFile = require.resolve("../src/lib/prisma"), clientFile = require.resolve("@prisma/client");
  if ([...targets.values(), ...allowed.values()].some(file => file === prismaFile || file === clientFile)) throw new Error("FIXTURE_GUARD_OVERRIDE_REFUSED");
  if ([...targets.values()].some(file => [...allowed.values()].includes(file))) throw new Error("FIXTURE_TARGET_OVERRIDE_REFUSED");
  const client: Exports = require("@prisma/client");
  if (typeof client.PrismaClient !== "function") throw new Error("REAL_PRISMA_CLIENT_REQUIRED");
  const network: { object: object; key: PropertyKey }[] = [{ object: globalThis, key: "fetch" }];
  for (const [builtin, keys] of [["node:http", ["request", "get"]], ["node:https", ["request", "get"]], ["node:net", ["connect", "createConnection"]], ["node:tls", ["connect"]]] as const) {
    const builtinModule: Exports = require(builtin); for (const key of keys) network.push({ object: builtinModule, key });
  }
  const net: { Socket: { prototype: object } } = require("node:net"); network.push({ object: net.Socket.prototype, key: "connect" });
  const planned = [{ object: globalThis, key: "prisma" }, ...network].map(patch => ({ ...patch, before: Object.getOwnPropertyDescriptor(patch.object, patch.key) }));
  const owner = Symbol("module fixture"), initial = new Map(Object.entries(require.cache));
  const cache = new Map<string, { before: NodeJS.Module | undefined; installed: NodeJS.Module | undefined }>();
  const patches: Patch[] = [];
  let closed = false;
  const active = () => { if (closed || activeOwner !== owner) throw new Error("FIXTURE_SCOPE_CLOSED"); };
  const blocked = (code: string) => () => { active(); throw new Error(code); };
  const patch = (object: object, key: PropertyKey, value: unknown) => {
    const captured = planned.find(patch => patch.object === object && patch.key === key);
    if (!captured || !sameDescriptor(Object.getOwnPropertyDescriptor(object, key), captured.before)) throw new Error("FIXTURE_GLOBAL_CONFLICT");
    const before = captured.before;
    if (before && !before.configurable && (!before.writable || before.get || before.set)) throw new Error("FIXTURE_GLOBAL_NOT_PATCHABLE");
    Object.defineProperty(object, key, { value, enumerable: before?.enumerable ?? false, configurable: before?.configurable ?? true, writable: before?.writable ?? true });
    patches.push({ object, key, before, installed: Object.getOwnPropertyDescriptor(object, key)! });
  };
  const inject = (file: string, exports: Exports) => {
    if (require.cache[file] !== initial.get(file)) throw new Error("FIXTURE_CACHE_CONFLICT");
    const stubModule = new Module(file); stubModule.filename = file; stubModule.loaded = true; stubModule.exports = exports;
    cache.set(file, { before: require.cache[file], installed: stubModule }); require.cache[file] = stubModule;
  };
  const missing = new Proxy(blocked("UNEXPECTED_PRISMA_CALL"), { get: () => missing });
  const guarded = (value: object): object => new Proxy(value, {
    get(target, key, receiver) {
      active(); const result: unknown = Reflect.get(target, key, receiver);
      if (result === undefined) return missing;
      if (typeof result === "function") return new Proxy(result, { apply(fn, thisArg, args) {
        active();
        if (key === "$transaction" && typeof args[0] === "function") {
          const operation = args[0]; args = [async (tx: object) => Reflect.apply(operation, undefined, [guarded(tx)]), ...args.slice(1)];
        }
        return Reflect.apply(fn, thisArg, args);
      } });
      return result && typeof result === "object" && Object.getPrototypeOf(result) === Object.prototype ? guarded(result) : result;
    },
  });
  const collectOwned = () => {
    // При setup throw у дочернего Module.parent остаётся ссылка на неудачный target.
    for (const [file, entry] of Object.entries(require.cache)) {
      if (!entry || initial.has(file) || cache.has(file)) continue;
      const visited = new Set<NodeJS.Module>(); let parent: NodeJS.Module | null | undefined = entry;
      while (parent && !visited.has(parent)) {
        if ([...targets.values()].includes(parent.filename)) { cache.set(file, { before: undefined, installed: entry }); break; }
        visited.add(parent); parent = parent.parent;
      }
    }
  };
  const restore = () => {
    if (closed) return;
    collectOwned(); const conflicts: string[] = [], cacheConflicts = new Set<string>(), patchConflicts = new Set<Patch>();
    for (const [file, captured] of cache) if (require.cache[file] !== captured.installed) { conflicts.push("FIXTURE_CACHE_CONFLICT"); cacheConflicts.add(file); }
    for (const captured of patches) if (!sameDescriptor(Object.getOwnPropertyDescriptor(captured.object, captured.key), captured.installed)) { conflicts.push("FIXTURE_GLOBAL_CONFLICT"); patchConflicts.add(captured); }
    closed = true;
    // Проверены все конфликты; чужие записи не перетираются, остальные guards снимаются.
    for (const [file, captured] of cache) if (!cacheConflicts.has(file)) { if (captured.before) require.cache[file] = captured.before; else delete require.cache[file]; }
    const own = new Set([...cache.values()].map(captured => captured.installed));
    for (const entry of Object.values(require.cache)) if (entry?.children.some(child => own.has(child))) entry.children = entry.children.filter(child => !own.has(child));
    for (const captured of [...patches].reverse()) if (!patchConflicts.has(captured)) {
      if (captured.before) Object.defineProperty(captured.object, captured.key, captured.before); else Reflect.deleteProperty(captured.object, captured.key);
    }
    activeOwner = undefined; syncBuiltinESMExports();
    if (conflicts.length) throw new AggregateError(conflicts.map(code => new Error(code)), "FIXTURE_RESTORE_CONFLICT");
  };
  activeOwner = owner;
  try {
    inject(clientFile, { ...client, PrismaClient: new Proxy(client.PrismaClient, { construct: blocked("UNEXPECTED_PRISMA_CONSTRUCTION") }) });
    const prisma = guarded(options.prisma); patch(globalThis, "prisma", prisma); inject(prismaFile, { prisma });
    for (const [name, exports] of Object.entries(options.overrides)) {
      const wrapped = Object.fromEntries(Object.entries(exports).map(([key, value]) => [key, typeof value === "function" ? new Proxy(value, { apply(fn, thisArg, args) { active(); return Reflect.apply(fn, thisArg, args); } }) : value]));
      inject(allowed.get(name)!, wrapped);
    }
    for (const patchInfo of network) patch(patchInfo.object, patchInfo.key, blocked("UNEXPECTED_NETWORK_CALL")); syncBuiltinESMExports();
    for (const file of targets.values()) { const before = require.cache[file]; if (before !== initial.get(file)) throw new Error("FIXTURE_CACHE_CONFLICT"); delete require.cache[file]; cache.set(file, { before, installed: undefined }); }
  } catch (failure) {
    try { restore(); } catch (cleanup) { throw new AggregateError([failure, cleanup], "FIXTURE_SETUP_AND_RESTORE_FAILED"); }
    throw failure;
  }
  return {
    load<T>(specifier: string): T {
      active(); const file = targets.get(specifier); if (!file) throw new Error("FIXTURE_TARGET_NOT_ALLOWED");
      if (require.cache[file] !== cache.get(file)?.installed) throw new Error("FIXTURE_CACHE_CONFLICT");
      const before = initial.get(file);
      try {
        const result: unknown = require(file), entry = require.cache[file];
        if (!entry || entry.exports !== result) throw new Error("FIXTURE_TARGET_CACHE_CHANGED");
        cache.set(file, { before, installed: entry }); return result as T;
      } finally { collectOwned(); }
    },
    restore,
    async run<T>(operation: () => T | Promise<T>): Promise<T> {
      let result: T | undefined, failure: unknown, failed = false;
      try { result = await operation(); } catch (error) { failed = true; failure = error; }
      try { restore(); } catch (cleanup) { if (failed) throw new AggregateError([failure, cleanup], "FIXTURE_RUN_AND_RESTORE_FAILED"); throw cleanup; }
      if (failed) throw failure;
      return result as T;
    },
  };
}
