/**
 * Cache the shell so the app opens instantly and, on a bad signal, opens at
 * all — you can still capture a thought with no bars and develop it later.
 *
 * The API is never cached: a stale answer to a different thought would be
 * worse than an error.
 */
const CACHE = "high-thoughts-v1";

const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/store.js",
  "/markdown.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Network first, so a deploy reaches the phone without a hard reload; the
  // cache is the fallback rather than the source of truth.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? caches.match("/index.html")),
  );
});
