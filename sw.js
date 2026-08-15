/* =========================================================
   PRRD & POE App - Service Worker
   v6 · Funcionamiento sin conexión en PC y celular

   Cambio respecto a v5: la instalación ya no se aborta si falta
   un archivo (por ejemplo, un ícono guardado en otra carpeta).
   Solo index.html es obligatorio; el resto se guarda si existe.
   ========================================================= */

const CACHE_VERSION = 'prrd-poe-v6';
const CACHE_RUNTIME = 'prrd-poe-runtime-v6';

/* Lo único imprescindible para que la app abra sin conexión. */
const CORE_REQUIRED = './index.html';

/* Deseables: se intentan uno por uno y ninguno bloquea la instalación.
   Se listan las dos rutas posibles de los íconos (raíz y carpeta icons/),
   así funciona estén donde estén. */
const OPTIONAL_ASSETS = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.add(new Request(CORE_REQUIRED, { cache: 'reload' }));
    await Promise.all(OPTIONAL_ASSETS.map(url =>
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
