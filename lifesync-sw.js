const CACHE_NAME = "lifesync-shell-v32-v118-20261002";
const APP_SHELL = ["./", "./index.html", "./assets/supabase-2.45.4.min.js", "./manifest.webmanifest", "./assets/lifesync-app-icon-192-20260918.png", "./assets/lifesync-app-icon-512-20260918.png", "./assets/lifesync-apple-touch-icon-180-20260918.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "LifeSync 알림";
  const options = {
    body: data.body || "예정된 일정을 확인해 주세요.",
    icon: "./assets/lifesync-app-icon-192-20260918.png",
    badge: "./assets/lifesync-app-icon-192-20260918.png",
    tag: data.tag || "lifesync-reminder",
    renotify: true,
    requireInteraction: true,
    silent: data.silent === true,
    actions: [
      { action: "confirm", title: "확인" },
      { action: "open", title: "확인하고 열기" }
    ],
    data: { url: data.url || "./index.html", key: data.key || "" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const key = event.notification.data && event.notification.data.key;
  const target = new URL((event.notification.data && event.notification.data.url) || "./index.html", self.location.href).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    list.forEach(client => client.postMessage({ type: "lifesync-alarm-ack", key }));
    if (event.action === "confirm") return;
    for (const client of list) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        client.navigate(target);
        return client.focus();
      }
    }
    return clients.openWindow ? clients.openWindow(target) : undefined;
  }));
});
