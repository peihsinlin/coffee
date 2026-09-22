// 杯測評分表 - Service Worker
// 目的：快取 app shell，讓「加入主畫面」後可離線開啟與評分。
// 每次更動任何被快取的檔案時，請把 CACHE_VERSION 往上加一，
// 否則使用者裝置上的舊快取不會更新。
const CACHE_VERSION = 'v2';
const CACHE_NAME = `cupping-score-${CACHE_VERSION}`;

// 使用相對路徑，這樣不論部署在網站根目錄或子目錄都能正確快取。
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './vendor.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// 策略：app shell（同源檔案）採「快取優先、背景更新」，離線時仍可完整使用；
// 其他跨網域請求（例如 Google Fonts）維持一般網路請求，失敗就交給瀏覽器處理，
// CSS 已有系統字型 fallback，不影響離線可用性。
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin) return; // 讓瀏覽器照常處理跨網域請求

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached); // 離線時網路請求失敗，回退到快取

      // 有快取先回應（快），同時背景更新快取；沒快取就等網路。
      return cached || networkFetch;
    })
  );
});
