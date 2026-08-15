/* =========================================================
   PRRD & POE App - Service Worker
   v5 · Funcionamiento sin conexión en PC y celular
   ========================================================= */

const CACHE_VERSION = 'prrd-poe-v5';
const CACHE_RUNTIME = 'prrd-poe-runtime-v5';

/* Archivos propios de la app: si alguno falta, la instalación falla,
   así que solo van los que están sí o sí en el repositorio. */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* Recursos externos (CDN). Los íconos ya no dependen de ningún CDN:
   van como SVG dentro del propio index.html. */
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(CORE_ASSETS);
    // Los externos se intentan uno por uno: si un CDN falla, la app igual se instala.
    await Promise.all(CDN_ASSETS.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE_VERSION && k !== CACHE_RUNTIME)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* Navegación: red primero (para traer cambios), caché si no hay señal. */
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(CACHE_VERSION);
    cache.put('./index.html', fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await caches.match('./index.html', { ignoreSearch: true });
    return cached || new Response(
      '<h1>Sin conexión</h1><p>Abre la app una vez con internet para guardarla en este dispositivo.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    );
  }
}

/* Estáticos: caché primero y actualización en segundo plano. */
async function handleAsset(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  const network = fetch(request).then(async (response) => {
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(CACHE_RUNTIME);
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET: los enlaces tel:, sms: y whatsapp no pasan por aquí.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request));
});
