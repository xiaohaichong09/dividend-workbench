/* 攒股收息 · 腾讯行情（script 注入，避开跨域限制） */
(function (App) {
  "use strict";

  const U = App.util;

  /**
   * 批量取行情。腾讯接口返回 GBK 编码的全局变量 v_sh601318="..."。
   * 返回 { sh601318: { name, price }, ... }
   */
  function quoteFetch(codes) {
    return new Promise((resolve) => {
      const list = (codes || []).filter(Boolean);
      if (!list.length) return resolve({});

      const map = {};
      let script = null;
      let finished = false;
      let timer = null;

      function done() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        list.forEach((full) => {
          const raw = window["v_" + full];
          if (typeof raw !== "string" || raw.length < 10) return;
          const parts = raw.split("~");
          const price = parseFloat(parts[3]);
          if (price > 0) map[full] = { name: parts[1] || "", price };
        });
        if (script && script.parentNode) script.remove();
        list.forEach((full) => {
          try {
            delete window["v_" + full];
          } catch (e) {
            window["v_" + full] = undefined;
          }
        });
        resolve(map);
      }

      try {
        script = document.createElement("script");
        script.charset = "gbk";
        script.src = "https://qt.gtimg.cn/q=" + list.join(",") + "&r=" + Math.random();
        script.onload = () => setTimeout(done, 250);
        script.onerror = done;
        timer = setTimeout(done, 9000);
        document.head.appendChild(script);
      } catch (e) {
        done();
      }
    });
  }

  function uniqueCodes() {
    const set = new Set();
    App.store.state.stocks.forEach((st) => {
      const full = U.withPrefix(st.code);
      if (full) set.add(full);
    });
    return Array.from(set);
  }

  async function refreshAll() {
    const codes = uniqueCodes();
    if (!codes.length) {
      App.ui.toast("标的还没填 6 位代码，无法自动刷新", "err");
      return { ok: 0, fail: 0 };
    }

    App.ui.toast("正在刷新行情…", "info", { duration: 1800 });
    const chunks = [];
    for (let i = 0; i < codes.length; i += 40) chunks.push(codes.slice(i, i + 40));
    const maps = await Promise.all(chunks.map(quoteFetch));
    const map = Object.assign({}, ...maps);

    let ok = 0;
    let fail = 0;
    App.store.state.stocks.forEach((st) => {
      const full = U.withPrefix(st.code);
      const q = full ? map[full] : null;
      if (q) {
        st.price = q.price;
        if (!String(st.name || "").trim()) st.name = q.name;
        ok += 1;
      } else if (full) {
        fail += 1;
      }
    });

    if (ok) App.store.save();
    if (ok) {
      App.ui.toast(
        "已刷新 " + ok + " 只行情" + (fail ? "，" + fail + " 只未取到" : ""),
        "ok"
      );
    } else {
      App.ui.toast("刷新失败，请检查网络或代码", "err");
    }
    return { ok, fail };
  }

  /** 单个代码识别：返回 { name, price } 或 null */
  async function lookup(code) {
    const full = U.withPrefix(code);
    if (!full) return null;
    const map = await quoteFetch([full]);
    return map[full] || null;
  }

  App.quotes = { quoteFetch, refreshAll, lookup, uniqueCodes };
})(window.App = window.App || {});
