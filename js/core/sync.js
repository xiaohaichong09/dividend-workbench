/* 攒股收息 · Cloudflare 同步（Pages Function / Worker 均可，挂载到 window.App.sync） */
(function (App) {
  "use strict";

  const U = App.util;
  // GitHub Pages / 本地文件打开时没有同域接口，回退到 Pages 上的同步接口（已开放 CORS）
  const REMOTE_FALLBACK = "https://dividend-app-cym.pages.dev/api/sync";
  const REQUEST_TIMEOUT = 15000;
  const PUSH_DELAY = 2200;

  let pushTimer = null;
  let running = null;
  let queued = false;
  let lastPushedAt = 0;

  function defaultUrl() {
    const host = location.hostname;
    if (location.protocol === "file:" || host.endsWith(".github.io")) return REMOTE_FALLBACK;
    return "/api/sync";
  }

  function endpoint() {
    const custom = ((App.store.state.settings || {}).syncUrl || "").trim();
    return custom || defaultUrl();
  }

  function hasKey() {
    return !!((App.store.state.settings || {}).syncKey || "").trim();
  }

  function status(kind, message, extra) {
    const meta = Object.assign(
      { at: Date.now(), ok: kind === "ok" ? true : kind === "err" ? false : null, message: message || "" },
      extra || {}
    );
    App.store.setSyncMeta(meta);
    App.ui.setSyncChip(kind, message);
    App.ui.refreshSyncStatus(meta);
    App.bus.emit("sync:status", { kind, message: message || "", meta });
    return meta;
  }

  function request(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const opts = Object.assign({}, options || {});
    opts.signal = controller.signal;
    opts.cache = "no-store";
    return fetch(url, opts).finally(() => clearTimeout(timer));
  }

  function authHeaders(extra) {
    return Object.assign(
      {
        "X-Auth-Key": (App.store.state.settings.syncKey || "").trim(),
        "X-Client-Version": App.version || "2",
      },
      extra || {}
    );
  }

  /** 上传到云端前去掉同步密钥等本机配置（密钥不离开本机） */
  function cloudSnapshot() {
    const copy = JSON.parse(JSON.stringify(App.store.state));
    copy.settings = { syncUrl: "", syncKey: "", auto: true };
    return copy;
  }

  function parseRemote(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("云端返回的数据不是有效 JSON");
    }
    if (!data || typeof data !== "object" || !Array.isArray(data.stocks)) {
      throw new Error("云端数据格式不正确");
    }
    return data;
  }

  async function push(manual) {
    const body = JSON.stringify(cloudSnapshot());
    const res = await request(endpoint(), {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body,
    });
    if (res.status === 401) throw new Error("同步密钥不正确");
    if (res.status === 413) throw new Error("数据超过云端大小限制");
    if (!res.ok) throw new Error("上传失败（HTTP " + res.status + "）");
    lastPushedAt = App.store.state.updatedAt;
    const first = !(App.store.syncMeta().at || 0);
    status("ok", "已上传到云端");
    if (manual) App.ui.toast(first ? "已首次上传到云端" : "已上传本地数据到云端", "ok");
    App.bus.emit("sync:pushed", { at: lastPushedAt });
  }

  async function pull(remote, manual) {
    // 同步配置是每台设备自己的，不跟随云端覆盖
    App.store.replace(remote, { backup: true, preserveSettings: true });
    App.store.save({ touch: false, push: false, silent: true });
    lastPushedAt = Number(remote.updatedAt) || 0;
    status("ok", "已拉取云端数据");
    if (manual) App.ui.toast("已拉取云端较新的数据", "ok");
    App.bus.emit("sync:pulled", { at: lastPushedAt });
  }

  async function doSync(options) {
    const opts = options || {};
    const manual = opts.manual === true;

    if (!hasKey()) {
      status("off", "未配置同步");
      if (manual) App.ui.toast("请先在设置里填写同步密钥", "err");
      return { ok: false, reason: "no-key" };
    }
    if (!navigator.onLine) {
      status("err", "当前离线");
      if (manual) App.ui.toast("当前没有网络，稍后会自动重试", "err");
      return { ok: false, reason: "offline" };
    }

    status("sync", "正在同步…");
    try {
      const res = await request(endpoint(), { headers: authHeaders() });

      if (res.status === 401) throw new Error("同步密钥不正确");
      if (res.status === 404) {
        await push(manual);
        return { ok: true, action: "push" };
      }
      if (!res.ok) throw new Error("读取云端失败（HTTP " + res.status + "）");

      const remote = parseRemote(await res.text());
      const localAt = Number(App.store.state.updatedAt) || 0;
      const remoteAt = Number(remote.updatedAt) || 0;
      // 新设备本地还是空的：即使本地时间戳更新，也不要覆盖云端已有数据
      const localEmpty = App.store.state.stocks.length === 0;
      const remoteHasData = Array.isArray(remote.stocks) && remote.stocks.length > 0;

      if (remoteAt > localAt || (localEmpty && remoteHasData)) {
        await pull(remote, manual);
        return { ok: true, action: "pull" };
      }

      // 本地时间不早于云端：以本地为准
      await push(manual);
      return { ok: true, action: "push" };
    } catch (e) {
      const message =
        e && e.name === "AbortError" ? "请求超时，请检查网络或同步地址" : (e && e.message) || "未知错误";
      status("err", "同步失败：" + message);
      if (manual) App.ui.toast("同步失败：" + message, "err");
      return { ok: false, reason: message };
    }
  }

  function syncNow(options) {
    if (running) {
      queued = true;
      return running;
    }
    running = doSync(options).finally(() => {
      running = null;
      if (queued) {
        queued = false;
        setTimeout(() => syncNow({ manual: false }), 500);
      }
    });
    return running;
  }

  function schedulePush() {
    const settings = App.store.state.settings || {};
    if (!settings.auto || !hasKey()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow({ manual: false }), PUSH_DELAY);
  }

  /** 页面隐藏/关闭时尽量把最新数据发出去（keepalive 不受页面卸载影响） */
  function flush() {
    if (!hasKey() || !navigator.onLine) return;
    if ((Number(App.store.state.updatedAt) || 0) <= lastPushedAt) return;
    try {
      fetch(endpoint(), {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(cloudSnapshot()),
        keepalive: true,
      }).catch(() => {});
      lastPushedAt = App.store.state.updatedAt;
    } catch (e) {
      /* 忽略：下次打开还会同步 */
    }
  }

  async function test() {
    if (!hasKey()) {
      App.ui.toast("请先填写同步密钥", "err");
      return false;
    }
    status("sync", "正在测试连接…");
    try {
      const res = await request(endpoint(), { headers: authHeaders() });
      if (res.status === 401) throw new Error("同步密钥不正确");
      if (res.status === 404) {
        status("ok", "连接正常，云端还没有数据");
        App.ui.toast("连接正常，云端还没有数据（首次同步会上传）", "ok");
        return true;
      }
      if (!res.ok) throw new Error("服务返回 HTTP " + res.status);
      const remote = parseRemote(await res.text());
      status("ok", "连接正常，云端有数据");
      App.ui.toast(
        "连接正常 · 云端数据 " + U.timeAgo(Number(remote.updatedAt) || 0) + "更新",
        "ok"
      );
      return true;
    } catch (e) {
      const message =
        e && e.name === "AbortError" ? "请求超时" : (e && e.message) || "未知错误";
      status("err", "连接失败：" + message);
      App.ui.toast("连接失败：" + message, "err");
      return false;
    }
  }

  function start() {
    const settings = App.store.state.settings || {};
    lastPushedAt = Number(App.store.syncMeta().at ? App.store.state.updatedAt : 0) || 0;

    // 即使当前还没填密钥也要监听，用户在设置页填完即可生效
    window.addEventListener("online", () => {
      if (App.store.state.settings.auto) syncNow({ manual: false });
    });
    window.addEventListener("offline", () => status("err", "当前离线"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);

    if (!hasKey()) {
      App.ui.setSyncChip("off", "未配置同步");
      App.ui.refreshSyncStatus();
      return;
    }
    if (settings.auto) setTimeout(() => syncNow({ manual: false }), 400);
  }

  App.sync = {
    defaultUrl,
    endpoint,
    hasKey,
    syncNow,
    schedulePush,
    flush,
    test,
    start,
    cloudSnapshot,
  };
})(window.App = window.App || {});
