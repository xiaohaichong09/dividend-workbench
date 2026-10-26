/* 攒股收息 · 启动、路由与 Service Worker 更新 */
(function (App) {
  "use strict";

  const U = App.util;
  App.version = "2.1.0";

  function parseRoute() {
    const hash = location.hash || "#/";
    const stockMatch = hash.match(/^#\/stock\/([^/?#]+)/);
    if (stockMatch) {
      let id = stockMatch[1];
      try {
        id = decodeURIComponent(id);
      } catch (e) {
        /* 保持原值 */
      }
      return { name: "stock", id };
    }
    if (hash.indexOf("#/settings") === 0) return { name: "settings" };
    return { name: "overview" };
  }

  function updateTitle(route) {
    const base = "攒股收息 · 退休计划";
    if (route.name === "settings") document.title = "设置 · " + base;
    else if (route.name === "stock") {
      const st = route.id === "new" ? null : App.store.getStock(route.id);
      document.title = (st ? st.name : route.id === "new" ? "添加标的" : "标的") + " · " + base;
    } else document.title = base;
  }

  function render() {
    const route = parseRoute();
    App.ui.nav(route.name === "settings" ? "settings" : "home");
    updateTitle(route);

    try {
      if (route.name === "settings") App.views.settings.render();
      else if (route.name === "stock") App.views.stock.render(route.id);
      else App.views.overview.render();
    } catch (e) {
      console.error(e);
      document.getElementById("app").innerHTML =
        '<div class="panel"><h2>页面加载失败</h2><p class="about-note">' +
        U.esc(e.message || e) +
        '</p><div class="btn-row"><a class="btn" href="#/">返回总览</a></div></div>';
    }

    App.ui.refreshInstallUI();
    App.ui.refreshSyncStatus();

    window.scrollTo(0, 0);
  }

  function setupBus() {
    App.bus.on("state:replaced", () => render());
    App.bus.on("sync:pulled", () => render());
    App.bus.on("sync:status", () => App.ui.refreshSyncStatus());
    App.bus.on("storage:error", (err) => {
      App.ui.toast("本地保存失败：" + (err && err.message ? err.message : "存储空间不足"), "err", {
        duration: 7000,
      });
    });
  }

  function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol) && !["localhost", "127.0.0.1"].includes(location.hostname)) {
      return;
    }

    let refreshing = false;
    const showUpdate = (worker) => {
      App.ui.toast("发现新版本", "info", {
        duration: 0,
        action: {
          label: "立即更新",
          onClick: () => {
            if (worker) worker.postMessage({ type: "SKIP_WAITING" });
            else location.reload();
          },
        },
      });
    };

    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
        if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              showUpdate(worker);
            }
          });
        });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          location.reload();
        });

        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
      } catch (e) {
        console.warn("Service Worker 注册失败", e);
      }
    });
  }

  function setupStoragePersistence() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  }

  function setupGlobalErrors() {
    window.addEventListener("error", (e) => {
      if (!e || !e.message) return;
      console.error(e.error || e.message);
    });
    window.addEventListener("unhandledrejection", (e) => {
      console.error("未处理的异步错误", e.reason);
    });
  }

  function boot() {
    App.ui.bindGlobalUI();
    App.ui.initInstall();
    setupBus();
    setupGlobalErrors();
    setupStoragePersistence();
    setupServiceWorker();

    window.addEventListener("hashchange", render);
    render();

    App.sync.start();
  }

  App.router = { render, parseRoute };
  App.boot = boot;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window.App = window.App || {});
