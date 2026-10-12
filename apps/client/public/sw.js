/*
 * HavenWorld service worker (Part 9A §2.4 & Batch 29).
 *
 * Strategy:
 *  - Navigations: network-first with an offline fallback (/offline.html) so a lost connection
 *    still opens a polished offline status card instead of a raw browser error.
 *  - Same-origin build assets (/assets/*, /icons/*, Babylon/Havok chunks):
 *    cache-first — they are content-hashed or immutable.
 *  - API + WebSocket traffic: never cached. Game state must always be live.
 *  - Invalidation: handles skip waiting, outdated cache purge, and selective asset eviction.
 */

// Bump CACHE_VERSION when the caching strategy changes: the activate
// handler below deletes every cache from older versions, so a stuck old
// shell can never shadow a new deploy.
const CACHE_VERSION = 'havenworld-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

// Bound the asset cache: entries are content-hashed/immutable in practice,
// but an unbounded cache grows forever across deploys on long-lived installs.
const MAX_ASSET_ENTRIES = 250;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Cache shell assets individually: one 404/offline asset used to fail
      // the whole addAll() and block install (and therefore activation).
      await Promise.all(
        SHELL_ASSETS.map(async (asset) => {
          try {
            await cache.add(asset);
          } catch (err) {
            console.warn('[SW] shell asset failed to cache, continuing:', asset, err);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

const isCacheableAsset = (url) =>
  url.pathname.startsWith('/assets/') ||
  url.pathname.startsWith('/icons/') ||
  /\.(?:js|css|woff2?|png|jpe?g|svg|webp|glb|gltf|wasm|json)$/i.test(url.pathname);

/** Evict the oldest entries when a cache grows past its budget. */
const trimCache = async (cacheName, maxEntries) => {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const excess = keys.length - maxEntries;
    if (excess > 0) {
      await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
    }
  } catch (err) {
    console.warn('[SW] cache trim failed:', err);
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Live game traffic (API, socket.io polling/handshake) is never cached.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;

          const cachedOffline = await caches.match('/offline.html');
          if (cachedOffline) return cachedOffline;

          return new Response(
            '<!DOCTYPE html><html><body style="background:#0d1117;color:#fff;font-family:sans-serif;padding:2rem;text-align:center;">' +
              '<h1>HavenWorld Offline</h1><p>Please check your internet connection.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  if (!isCacheableAsset(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches
              .open(ASSET_CACHE)
              .then((cache) =>
                cache.put(request, copy).then(() => trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES))
              );
          }
          return response;
        })
        .catch(() => {
          // If an image request fails while offline, return cached icon fallback if available
          if (request.destination === 'image') {
            return caches.match('/icons/icon.svg');
          }
          return Response.error();
        });
    })
  );
});

// Cache invalidation and lifecycle messaging commands
self.addEventListener('message', async (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (typeof data === 'object' && data.type === 'SKIP_WAITING')) {
    await self.skipWaiting();
  } else if (data === 'CLEAR_OUTDATED_CACHES' || (typeof data === 'object' && data.type === 'CLEAR_OUTDATED_CACHES')) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => !key.startsWith(CACHE_VERSION))
        .map((key) => caches.delete(key))
    );
  } else if (data === 'INVALIDATE_ASSETS' || (typeof data === 'object' && data.type === 'INVALIDATE_ASSETS')) {
    await caches.delete(ASSET_CACHE);
  }
});