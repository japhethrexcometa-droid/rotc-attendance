// ROTC Attendance System — Service Worker for Offline Support
const CACHE_NAME = "rotc-pwa-v2";

// On install: cache the app shell
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache the main entry point; the rest gets cached as it's fetched
      return cache.addAll(["/", "/index.html"]).catch(() => {});
    })
  );
});

// On activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy: Network-first for API/Supabase, Cache-first for static assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache Supabase API calls or POST requests
  if (
    event.request.method !== "GET" ||
    url.hostname.includes("supabase") ||
    url.hostname.includes("googleapis") ||
    url.pathname.startsWith("/rest/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/storage/")
  ) {
    return;
  }

  // For navigation requests (HTML pages): network-first with cache fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // For static assets (JS, CSS, images, fonts): stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
