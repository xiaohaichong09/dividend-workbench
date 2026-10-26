/* 攒股收息 · UI 基础件：Toast、确认框、同步指示灯、安装提示 */
(function (App) {
  "use strict";

  const U = App.util;
  const $ = U.$;
  const $$ = U.$$;

  /* ---------------- Toast ---------------- */
  function toast(message, type, options) {
    const opts = options || {};
    const wrap = $("#toast-wrap");
    if (!wrap) return null;

    while (wrap.children.length >= 4) wrap.firstElementChild.remove();

    const el = document.createElement("div");
    el.className = "toast " + (type || "");

    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = String(message == null ? "" : message);
    el.appendChild(text);

    let timer = null;
    const close = () => {
      clearTimeout(timer);
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 220);
    };

    if (opts.action && opts.action.label) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = opts.action.label;
      btn.addEventListener("click", () => {
        try {
          opts.action.onClick && opts.action.onClick();
        } finally {
          close();
        }
      });
      el.appendChild(btn);
    }

    wrap.appendChild(el);
    const duration = opts.duration != null ? opts.duration : opts.action ? 9000 : 3800;
    if (duration > 0) timer = setTimeout(close, duration);
    return el;
  }

  /* ---------------- 确认框 ---------------- */
  let confirmResolve = null;

  function confirmBox(message, options) {
    const opts = options || {};
    const mask = $("#confirm-mask");
    const text = $("#confirm-text");
    const yes = $("#confirm-yes");
    const no = $("#confirm-no");
    if (!mask || !text || !yes || !no) return Promise.resolve(false);

    text.textContent = String(message || "");
    yes.textContent = opts.okText || "确定";
    no.textContent = opts.cancelText || "取消";
    yes.className = "btn" + (opts.danger === false ? "" : " danger-solid");
    mask.classList.add("show");

    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  function settleConfirm(value) {
    const mask = $("#confirm-mask");
    if (mask) mask.classList.remove("show");
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(value);
  }

  /* ---------------- 导航高亮 ---------------- */
  function nav(name) {
    $$(".nav a").forEach((a) => {
      a.classList.toggle("active", a.dataset.nav === name);
      if (a.dataset.nav === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  /* ---------------- 同步指示灯 ---------------- */
  function setSyncChip(kind, text) {
    const chip = $("#sync-chip");
    if (!chip) return;
    chip.dataset.state = kind || "off";
    chip.title = text || "";
    const label = chip.querySelector(".sync-text");
    if (label) label.textContent = text || "";
  }

  function refreshSyncStatus(meta) {
    const statusEl = $("#sync-status");
    if (statusEl) {
      const m = meta || (App.store && App.store.syncMeta()) || {};
      if (m.ok === true) {
        statusEl.className = "syncstatus ok";
        statusEl.textContent = (m.message || "同步正常") + " · " + U.timeAgo(m.at);
      } else if (m.ok === false) {
        statusEl.className = "syncstatus err";
        statusEl.textContent = (m.message || "同步失败") + (m.at ? " · " + U.timeAgo(m.at) : "");
      } else {
        statusEl.className = "syncstatus";
        statusEl.textContent = "尚未同步";
      }
    }
    const lastEl = $("#last-sync");
    if (lastEl) {
      const m = meta || (App.store && App.store.syncMeta()) || {};
      lastEl.textContent = m.at ? "上次同步：" + U.timeAgo(m.at) : "尚未同步";
    }
  }

  /* ---------------- 安装 PWA ---------------- */
  let installEvent = null;
  let installedThisSession = false;

  function initInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      installEvent = e;
      refreshInstallUI();
    });
    window.addEventListener("appinstalled", () => {
      installEvent = null;
      installedThisSession = true;
      refreshInstallUI();
      toast("已安装到桌面，可以像 App 一样打开", "ok");
    });
    refreshInstallUI();
  }

  function canInstall() {
    return !!installEvent;
  }

  function isInstalled() {
    return installedThisSession || U.isStandalone();
  }

  async function promptInstall() {
    if (!installEvent) {
      if (U.isIOS()) {
        toast("iPhone：Safari 分享按钮 → 添加到主屏幕", "info", { duration: 6000 });
      } else {
        toast("浏览器菜单 → 添加到主屏幕 / 安装应用", "info", { duration: 6000 });
      }
      return false;
    }
    installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    if (choice && choice.outcome === "accepted") {
      installEvent = null;
      refreshInstallUI();
      return true;
    }
    return false;
  }

  function refreshInstallUI() {
    const installed = isInstalled();
    $$("[data-install]").forEach((btn) => {
      if (installed) {
        btn.textContent = "已安装";
        btn.disabled = true;
      } else if (canInstall()) {
        btn.textContent = "安装 App";
        btn.disabled = false;
      } else {
        btn.textContent = U.isIOS() ? "查看安装步骤" : "添加到桌面";
        btn.disabled = false;
      }
    });
    const hint = $("#install-hint");
    if (hint) {
      if (installed) hint.textContent = "已安装，直接从桌面图标打开即可。";
      else if (canInstall()) hint.textContent = "浏览器已支持一键安装，点上面的按钮即可。";
      else if (U.isIOS()) hint.textContent = "iPhone / iPad：Safari 底部「分享」→「添加到主屏幕」。";
      else hint.textContent = "安卓 Chrome：右上角菜单 →「添加到主屏幕 / 安装应用」。";
    }
  }

  /* ---------------- 按钮忙碌态 ---------------- */
  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
      btn.disabled = true;
      btn.classList.add("is-busy");
      if (label) btn.textContent = label;
    } else {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
      delete btn.dataset.originalText;
    }
  }

  function bindGlobalUI() {
    const yes = $("#confirm-yes");
    const no = $("#confirm-no");
    const mask = $("#confirm-mask");
    if (yes) yes.addEventListener("click", () => settleConfirm(true));
    if (no) no.addEventListener("click", () => settleConfirm(false));
    if (mask) {
      mask.addEventListener("click", (e) => {
        if (e.target === mask) settleConfirm(false);
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mask && mask.classList.contains("show")) settleConfirm(false);
    });
  }

  App.ui = {
    toast,
    confirm: confirmBox,
    nav,
    setSyncChip,
    refreshSyncStatus,
    initInstall,
    canInstall,
    isInstalled,
    promptInstall,
    refreshInstallUI,
    setBusy,
    bindGlobalUI,
  };
})(window.App = window.App || {});
