'use strict';
// PWA 的離線快取／App殼快取。只快取「同網域」的請求，Google Fonts 等外部資源不攔截，交給瀏覽器自己處理。
//
// 策略：一律先嘗試連網拿最新版本（確保平常更新 index.html／script.js／style.css 的 ?v= 版本號後，
// 使用者只要有網路就能立刻吃到新版本，不需要另外手動同步這裡的快取版本號），
// 連不上網（離線）時才退回使用上次快取到的版本，讓離線時仍能打開 App、繼續使用已經記錄好的內容。
//
// 這個快取名稱只有在「新增／移除」PRECACHE_URLS 裡列的檔案時才需要手動改版號（例如換了圖示檔名），
// 平常修改 script.js／style.css／index.html 的內容不需要動到這個檔案。
var CACHE_NAME = 'roast-log-shell-v1';
var PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(PRECACHE_URLS);
    }).catch(function(){ /* 離線安裝或個別檔案抓取失敗時不要卡住安裝流程 */ })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(req).then(function(res){
      var resClone = res.clone();
      caches.open(CACHE_NAME).then(function(cache){ cache.put(req, resClone); }).catch(function(){});
      return res;
    }).catch(function(){
      return caches.match(req).then(function(cached){
        return cached || caches.match('./index.html');
      });
    })
  );
});
