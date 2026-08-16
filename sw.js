/* ============================================================================
   PRRD & POE App - Service Worker
   Hace que la app se pueda instalar y funcione sin conexión en PC y celular.
   Sube CACHE_VERSION cada vez que edites index.html para forzar la actualización.
   ============================================================================ */

const CACHE_VERSION = 'prrd-poe-v5';
const CORE_CACHE = CACHE_VERSION + '-core';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

/* Lo mínimo imprescindible: si esto falla, la app no puede abrirse sin conexión. */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

/* Deseables: si alguno falta, se omite sin romper la instalación del service worker. */
const OPTIONAL_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

/* Recursos externos (Tailwind y la tipografía). Se cachean sin 'no-cors' para
   poder verificar la respuesta; si el CDN falla, la app igual se instala. */
const EXTERNAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await cache.addAll(CORE_ASSETS);
    await Promise.allSettled(
      [...OPTIONAL_ASSETS, ...EXTERNAL_ASSETS].map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res && res.ok) await cache.put(url, res.clone());
        } catch (e) { /* sin conexión al instalar: se cachea luego en runtime */ }
      })
    );
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CORE_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* La página pide activar la versión nueva cuando el usuario toca "Actualizar ahora". */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Nunca interceptar tel:, sms:, mailto: ni esquemas de extensiones. */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Navegación (abrir la app): red primero, y si no hay, el index cacheado. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        const fresh = await fetch(req);
        const cache = await caches.open(CORE_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || Response.error();
      }
    })());
    return;
  }

  /* Resto de recursos: caché primero, con actualización silenciosa en segundo plano. */
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(req, fresh.clone());
          }
        } catch (e) {}
      })());
      return cached;
    }

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && (url.origin === self.location.origin || EXTERNAL_ASSETS.some(a => req.url.startsWith(a.split('?')[0])))) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      const fallback = await caches.match('./index.html');
      return fallback || Response.error();
    }
  })());
});
