// Всё вне этого списка требует сервера: ни страницы, ни RSC, ни API/файлы
// сотрудника не должны возвращаться из offline-кеша после отзыва доступа.
export function isPublicCacheAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    ["/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest"].includes(pathname);
}

// Имена прежних runtime-кешей из @serwist/next defaultCache.
export const LEGACY_PRIVATE_CACHES = [
  "apis", "pages", "pages-rsc", "pages-rsc-prefetch", "others", "next-data",
  "static-data-assets", "next-image", "static-image-assets",
  "static-audio-assets", "static-video-assets", "cross-origin",
];
