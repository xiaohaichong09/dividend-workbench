/* 攒股收息 · Service Worker
 * - 预缓存应用外壳，离线可打开
 * - 页面导航：网络优先，失败回退缓存
 * - 静态资源：stale-while-revalidate（先用缓存，后台更新）
 * - 同步接口永远直连，不缓存
 */
const VERSION = "gzsx-v11";
const CACHE = VERSION;
const CORE = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/core/util.js",
  "./js/core/store.js",
  "./js/core/ui.js",
  "./js/core/sync.js",
  "./js/services/quotes.js",
  "./js/services/dividends.js",
  "./js/views/overview.js",
  "./js/views/stock.js",
  "./js/views/settings.js",
  "./js/app.js",
  "./icons/icon-96.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          CORE.map((url) =>
            fetch(url, { cache: "reload" })
              .then((res) => {
                if (res && res.ok) return cache.put(url, res);
                return null;
              })
              .catch(() => null)
          )
        )
      )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function timeoutFetch(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 行情、分红等第三方请求直连
  if (url.pathname.indexOf("/api/") === 0) return; // 同步接口不缓存

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await timeoutFetch(request, 4500);
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        } catch (e) {
          return (
            (await cache.match(request)) ||
            (await cache.match("./index.html")) ||
            (await cache.match("./offline.html")) ||
            new Response("离线，请稍后重试", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })()
  );
});
