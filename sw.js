// 台股盤後看板的 Service Worker
// 作用：讓網站可以「加到主畫面」當 App 開，網路不穩或離線時顯示上次抓到的資料。
//
// 快取策略：
// - 網頁本身、data/*.json：先上網抓最新的，抓不到才用快取（資料永遠以最新為主）
// - CSS、JS、圖示、字型、外部套件：先用快取讓畫面秒開，同時在背景更新
// - 開頭動畫影片、後台、GitHub API：一律不經過這裡
//
// 改了 CSS/JS 後如果想讓大家立刻拿到新版，把下面的版本號加 1 即可。
const VERSION = "v2";
const CACHE = `taiex-board-${VERSION}`;

const PRECACHE = [
  "./",
  "index.html",
  "assets/style.css",
  "assets/app.js",
  "assets/icons/favicon.svg",
  "assets/icons/icon-192.png",
  "assets/intro/poster.jpg",
  "manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 先上網，失敗才用快取。快取時去掉 ?t=時間戳，這樣才找得到上一次的資料。
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(key) || (request.mode === "navigate" && await cache.match("./"));
    if (cached) return cached;
    throw err;
  }
}

// 先用快取，同時在背景更新
async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const update = fetch(event.request)
    .then((res) => {
      if (res.ok || res.type === "opaque") cache.put(event.request, res.clone());
      return res;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return update;
}

const CDN_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const path = url.pathname;
    if (path.endsWith(".mp4") || path.includes("admin")) return; // 影片、後台不處理
    if (req.mode === "navigate" || path.startsWith("/data/")) {
      event.respondWith(networkFirst(req));
      return;
    }
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
  // 其他外部網址（GitHub API、YouTube 縮圖等）照常連線
});
