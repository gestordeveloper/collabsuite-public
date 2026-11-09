import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// `self` in this file is really a ServiceWorkerGlobalScope, but the repo's single tsconfig
// (shared with the rest of the DOM-typed frontend) can't add the "webworker" lib without
// clashing with "DOM" — so the service-worker-only globals are cast through this local alias
// instead of touching tsconfig.json.
interface ServiceWorkerScope {
  skipWaiting: () => void;
  registration: ServiceWorkerRegistration;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  clients: { claim: () => Promise<void>; openWindow: (url: string) => Promise<any> };
}
const sw = self as unknown as ServiceWorkerScope;

// workbox-build's injectManifest step finds this spot by searching the built output for the
// literal text "self.__WB_MANIFEST" — it must stay written out directly (not through the `sw`
// alias above) or the build fails with "Unable to find a place to inject the manifest".
precacheAndRoute((self as any).__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/socket\.io\//, /^\/studiox(\/|$)/],
  })
);

registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: "google-fonts-cache",
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  /\.(?:png|jpg|jpeg|gif|webp|svg|ico)$/i,
  new CacheFirst({
    cacheName: "images-cache",
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  /\.(?:js|css)$/i,
  new StaleWhileRevalidate({
    cacheName: "static-resources-cache",
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  /^https:\/\/.*\.(?:googleapis|gstatic)\.com\/.*/i,
  new StaleWhileRevalidate({
    cacheName: "gstatic-cache",
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

sw.skipWaiting();
sw.addEventListener("activate", (event) => {
  event.waitUntil(sw.clients.claim());
});

// Web Push: the payload is the JSON string sent by notification.service.ts (title/body/link).
sw.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; link?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    // ignore malformed payloads
  }
  const title = data.title || "Collabsuite";
  event.waitUntil(
    sw.registration.showNotification(title, {
      body: data.body,
      icon: "/assets/images/pwa-192x192.png",
      badge: "/assets/images/pwa-64x64.png",
      data: { link: data.link || "/" },
    })
  );
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(sw.clients.openWindow(event.notification.data?.link || "/"));
});
