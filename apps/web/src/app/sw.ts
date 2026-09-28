/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";
import { isPublicCacheAsset, LEGACY_PRIVATE_CACHES } from "@/lib/private-cache-policy";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Инъектируется Serwist при сборке — список precache-ресурсов
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ sameOrigin, url }) => sameOrigin && !isPublicCacheAsset(url.pathname),
      handler: new NetworkOnly({ fetchOptions: { cache: "no-store" } }),
    },
    ...defaultCache,
  ],
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all(LEGACY_PRIVATE_CACHES.map((name) => caches.delete(name))));
});

serwist.addEventListeners();
