// 🚀 今後GitHubを更新するたびに、ここの「v4」を「v5」「v6」と書き換えるだけで、ユーザーに更新通知が届きます！
const CACHE_NAME = 'pwa-cache-v4'; 

const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/tf.min.js',
  './models_list.json'
];

// インストール：キャッシュ登録
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// アクティベート：古いキャッシュを自動削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList =>
      Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME) {
            console.log('古いキャッシュを削除:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// フェッチ（通信）：キャッシュ優先で返す
self.addEventListener('fetch', event => {
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

// 💡 画面（app.js）の「今すぐ更新」ボタンを押された時に実行される緊急上書き命令
self.addEventListener('message', event => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
