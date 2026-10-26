/* 攒股收息 · 通用工具（无依赖，挂载到 window.App.util） */
(function (App) {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  const num = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  const fmt = (value, digits = 2) =>
    (Number(value) || 0).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });

  const fmtInt = (value) => Math.round(Number(value) || 0).toLocaleString("zh-CN");

  const fmtPx = (value) =>
    (Number(value) || 0).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    });

  const fmtQty = (value) =>
    (Number(value) || 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });

  const fmtWan = (value) => {
    const n = Number(value) || 0;
    if (Math.abs(n) >= 10000) return fmt(n / 1e4) + " 万";
    return fmt(n);
  };

  const today = () => {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  };

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), wait);
    };
  }

  function cleanCode(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  /** 6 位纯数字代码（去掉 sh/sz/bj 前缀） */
  function code6(value) {
    const code = cleanCode(value).replace(/^(sh|sz|bj)/, "");
    return /^\d{6}$/.test(code) ? code : "";
  }

  /** 6 位代码转腾讯行情前缀：sh / sz / bj */
  function withPrefix(value) {
    let code = cleanCode(value);
    if (!code) return "";
    if (/^(sh|sz|bj)/.test(code)) return code;
    code = code.replace(/[^\d]/g, "");
    if (code.length !== 6) return "";
    if (/^[569]/.test(code)) return "sh" + code;
    if (/^[0123]/.test(code)) return "sz" + code;
    if (/^[48]/.test(code)) return "bj" + code;
    return "";
  }

  /** ETF / 场内基金：分红接口无公开跨域数据 */
  function isFund(fullCode) {
    return /^(sh51|sh56|sh58|sz15|sz16)/.test(cleanCode(fullCode));
  }

  function timeAgo(ts) {
    const t = Number(ts) || 0;
    if (!t) return "从未";
    const diff = Date.now() - t;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + " 天前";
    const d = new Date(t);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function readFile(file) {
    if (file && typeof file.text === "function") return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
      reader.readAsText(file, "utf-8");
    });
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true ||
      document.referrer.startsWith("android-app://")
    );
  }

  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  App.util = {
    $,
    $$,
    esc,
    num,
    fmt,
    fmtInt,
    fmtPx,
    fmtQty,
    fmtWan,
    today,
    uid,
    clamp,
    debounce,
    cleanCode,
    code6,
    withPrefix,
    isFund,
    timeAgo,
    download,
    readFile,
    isStandalone,
    isIOS,
  };
})(window.App = window.App || {});
