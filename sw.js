// Service Worker - PRRD & POE App
// Cachea el shell de la app + los recursos externos (Tailwind, FontAwesome,
// Google Fonts) para que la app abra completamente estilizada sin conexión.
// Esto es clave para una app de emergencias: debe abrir igual sin señal,
// sin wifi o con datos móviles cortados.
//
// Nota técnica: el Service Worker corre en su propio contexto y no hereda
// la CSP `connect-src 'self'` del documento HTML (esa directiva rige los
// fetch/XHR hechos DESDE la página, no los que hace el propio Service
// Worker). Por eso sí puede cachear los CDNs sin violar la CSP del sitio.

const CACHE_VERSION = 'v2';
const SHELL_CACHE = `prrd-poe-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `prrd-poe-runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json'
];

// Recursos externos que la app necesita para verse correctamente.
// Se precachean en la instalación (si hay internet en ese momento) y además
// se van cacheando "al vuelo" la primera vez que se usan, por si alguno
// cambia de versión o no se pudo precachear.
const EXTERNAL_SHELL = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await shellCache.addAll(APP_SHELL);

      const runtimeCache = await caches.open(RUNTIME_CACHE);
      // Precarga best-effort: si alguno falla (ej. sin internet en el
      // momento de instalar el Service Worker), no bloquea la instalación;
      // simplemente se cacheará más adelante en el primer fetch exitoso.
      await Promise.all(
        EXTERNAL_SHELL.map((url) =>
          fetch(url, { mode: 'no-cors' })
            .then((resp) => runtimeCache.put(url, resp))
            .catch(() => {})
        )
      );

      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isSameOrigin = event.request.url.startsWith(self.location.origin);

  if (isSameOrigin) {
    // Shell propio: cache-first, con actualización desde red si falta en caché.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // Recursos externos (Tailwind, FontAwesome, Google Fonts/gstatic):
  // stale-while-revalidate. Sirve la versión cacheada al instante si existe
  // (clave para que la app abra rápido y estilizada sin esperar red), y en
  // paralelo intenta traer una versión actualizada para la próxima vez.
  const isKnownCdn = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']
    .some((host) => event.request.url.includes(host));

  if (isKnownCdn) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const networkFetch = fetch(event.request, { mode: 'no-cors' })
          .then((response) => {
            cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => null);

        // Si hay copia en caché, se sirve al instante (offline-first para
        // estos recursos). Si no hay copia, se espera la red.
        return cached || (await networkFetch) || Response.error();
      })
    );
  }
});
