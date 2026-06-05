const CACHE_NAME = 'pwa-cache-v4'; // バージョンを更新
const urlsToCache = [
  './',                  // 「/」から「./」に修正
  './index.html',        // 「/index.html」から「./」に修正
  './css/style.css',     // 以下すべて先頭に「.」を追加
  './js/app.js',
  './js/tf.min.js',
  './models_list.json'
];

// インストールイベント：キャッシュ登録および即時アクティブ化
self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// アクティベートイベント：古いキャッシュを削除しクライアントを即制御
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList =>
      Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// フェッチイベント：キャッシュ優先でレスポンス、無ければネットワークフェッチ
self.addEventListener('fetch', event => {
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
