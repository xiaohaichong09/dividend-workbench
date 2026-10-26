/* 攒股收息 · 退休计划 —— 前端逻辑(原生JS无依赖)。功能按示例图,界面为深色金融风格 */
(function () {
  const app = document.getElementById("app");
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const fmt = (v, d = 2) => (Number(v) || 0).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtInt = v => Math.round(Number(v) || 0).toLocaleString("zh-CN");
  const fmtPx = v => (Number(v) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const fmtQty = v => (Number(v) || 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
  const fmtWan = v => fmt((Number(v) || 0) / 1e4) + "万";
  const today = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const LS_KEY = "gzsx_state_v1";

  /* ================= 状态与持久化 ================= */
  function migrate(s) {
    s = s || {};
    s.goal = Math.max(0, +s.goal || 200000);
    s.stocks = Array.isArray(s.stocks) ? s.stocks : [];
    s.settings = Object.assign({ syncUrl: "", syncKey: "", auto: true }, s.settings || {});
    s.updatedAt = +s.updatedAt || 0;
    s.stocks.forEach(st => {
      st.id = st.id || uid();
      st.receipts = Array.isArray(st.receipts) ? st.receipts.filter(r => r && r.date && +r.amount > 0) : [];
    });
    return s;
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return migrate(raw ? JSON.parse(raw) : {});
    } catch (e) { console.warn(e); return migrate({}); }
  }
  let state = loadState();
  let pushTimer = null, deferredPrompt = null, confirmCb = null;

  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) { toast("本地保存失败：" + e.message, "err"); }
    schedulePush();
  }

  /* ================= Toast / 确认框 ================= */
  function toast(msg, cls = "") {
    const d = document.createElement("div");
    d.className = "toast " + cls;
    d.textContent = msg;
    $("#toast-wrap").appendChild(d);
    setTimeout(() => d.remove(), 4000);
  }
  function confirmBox(text, cb) {
    $("#confirm-text").textContent = text;
    confirmCb = cb;
    $("#confirm-mask").classList.add("show");
  }
  $("#confirm-yes").onclick = () => { $("#confirm-mask").classList.remove("show"); const cb = confirmCb; confirmCb = null; cb && cb(); };
  $("#confirm-no").onclick = () => { $("#confirm-mask").classList.remove("show"); confirmCb = null; };

  /* ================= 计算 ================= */
  function totals() {
    const y = String(new Date().getFullYear());
    let annual = 0, cost = 0, mv = 0, rcvY = 0;
    for (const s of state.stocks) {
      annual += num(s.shares) * num(s.dps);
      cost += num(s.shares) * num(s.cost);
      mv += num(s.shares) * num(s.price);
      for (const r of s.receipts || []) if (String(r.date).startsWith(y)) rcvY += num(r.amount);
    }
    return {
      annual, cost, mv, rcvY,
      gap: state.goal - annual,
      pct: state.goal > 0 ? annual / state.goal * 100 : 0,
    };
  }

  /* ================= 分红自动取数(东方财富,仅股票;ETF无跨域接口) ================= */
  function isFundPrefix(full) { return /^(sh51|sh56|sh58|sz15|sz16)/.test(full); }
  async function fetchDivHistory(code) {
    const url = "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET"
      + "&columns=SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,EX_DIVIDEND_DATE,PRETAX_BONUS_RMB,IMPL_PLAN_PROFILE,ASSIGN_PROGRESS"
      + "&filter=(SECURITY_CODE%3D%22" + encodeURIComponent(code) + "%22)"
      + "&pageNumber=1&pageSize=30&sortTypes=-1&sortColumns=EX_DIVIDEND_DATE&source=WEB&client=WEB";
    const r = await fetchTimeout(url, {});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const rows = (j.result && j.result.data) || [];
    const todayMs = Date.now();
    return rows
      .filter(x => x.EX_DIVIDEND_DATE && +x.PRETAX_BONUS_RMB > 0
        && (x.ASSIGN_PROGRESS || "").indexOf("实施") >= 0
        && new Date(String(x.EX_DIVIDEND_DATE).slice(0, 10) + "T00:00:00").getTime() <= todayMs)
      .map(x => ({
        date: String(x.EX_DIVIDEND_DATE).slice(0, 10),
        per10: +x.PRETAX_BONUS_RMB,
        plan: x.IMPL_PLAN_PROFILE || "",
      }));
  }
  // 近12个月口径:窗口内每次分红合计;一年一次→自动命中今年或去年那次;一年两次→最近一次+上一次
  function trailingDiv(rows) {
    if (!rows.length) return null;
    const now = new Date();
    const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime();
    const used = rows.filter(r => new Date(r.date + "T00:00:00").getTime() >= from);
    if (used.length) return { perShare: used.reduce((a, r) => a + r.per10, 0) / 10, used, fallback: false };
    return { perShare: rows[0].per10 / 10, used: [rows[0]], fallback: true };
  }
  async function autoFetchDiv(codeRaw) {
    const box = $("#div-fetch");
    const code = String(codeRaw || "").trim().replace(/^(sh|sz|bj)/i, "");
    const full = withPrefix(code);
    box.innerHTML = "";
    if (!full) return;
    if (isFundPrefix(full)) {
      box.innerHTML = `<div class="about-note">ETF / 场内基金暂不支持自动取数,请按基金公告手动填"每份分红"金额</div>`;
      return;
    }
    box.innerHTML = `<div class="about-note">正在获取分红数据…</div>`;
    try {
      const rows = await fetchDivHistory(code);
      const t = trailingDiv(rows);
      if (!t) {
        box.innerHTML = `<div class="about-note">未查到 ${esc(code)} 的分红记录,请手动填写</div>`;
        return;
      }
      const perShare = +t.perShare.toFixed(4);
      const old = num($("#f-dps").value);
      $("#f-dps").value = perShare;
      box.innerHTML = `
        <div class="div-list">
          <div class="div-title">分红明细(除息日 · 方案 · 每股)</div>
          ${t.used.map(r => `
            <div class="div-row"><span>${esc(r.date)}</span><span>${esc(r.plan) || "10派" + r.per10 + "元"}</span><b>${(r.per10 / 10).toFixed(4)}</b></div>`).join("")}
          <div class="div-sum">近12个月合计 <b>${perShare.toFixed(4)}</b> 元/股,${old > 0 && Math.abs(old - perShare) > 1e-9 ? `原值 ${old} 已更新,` : ""}请核对后保存
            ${t.fallback ? `<div class="about-note" style="margin-top:4px;color:var(--amber)">近12个月无分红,已取最近一次(${t.used[0].date})</div>` : ""}</div>
        </div>`;
    } catch (e) {
      box.innerHTML = `<div class="about-note">分红取数失败(${esc(e.name === "AbortError" ? "超时" : e.message)}),请手动填写</div>`;
    }
  }

  /* ================= 行情(腾讯接口,script 注入免跨域) ================= */
  function withPrefix(code) {
    code = String(code || "").trim().toLowerCase();
    if (/^(sh|sz|bj)/.test(code)) return code;
    if (/^[569]/.test(code)) return "sh" + code;
    if (/^[0123]/.test(code)) return "sz" + code;
    if (/^[48]/.test(code)) return "bj" + code;
    return "";
  }
  function quoteFetch(codes) {
    return new Promise(resolve => {
      const map = {};
      let sc;
      try {
        sc = document.createElement("script");
        sc.charset = "gbk";
        sc.src = "https://qt.gtimg.cn/q=" + codes.join(",") + "&r=" + Math.random();
      } catch (e) { return resolve(map); }
      const done = () => {
        codes.forEach(full => {
          const raw = window["v_" + full];
          if (typeof raw === "string" && raw.length > 10) {
            const p = raw.split("~");
            const price = parseFloat(p[3]);
            if (price > 0) map[full] = { name: p[1] || "", price };
          }
        });
        sc.remove();
        resolve(map);
      };
      sc.onload = () => setTimeout(done, 250);
      sc.onerror = () => { sc.remove(); resolve(map); };
      document.head.appendChild(sc);
    });
  }
  async function refreshQuotes() {
    const codes = [...new Set(state.stocks.map(s => withPrefix(s.code)).filter(Boolean))];
    if (!codes.length) return toast("标的还没填代码,无法自动刷新", "err");
    toast("正在刷新行情…");
    const chunks = [];
    for (let i = 0; i < codes.length; i += 40) chunks.push(codes.slice(i, i + 40));
    const maps = await Promise.all(chunks.map(quoteFetch));
    const map = Object.assign({}, ...maps);
    let ok = 0, fail = 0;
    state.stocks.forEach(st => {
      const q = map[withPrefix(st.code)];
      if (q) { st.price = q.price; if (!(st.name || "").trim()) st.name = q.name; ok++; }
      else if (withPrefix(st.code)) fail++;
    });
    save();
    if (ok) toast("已刷新 " + ok + " 只行情" + (fail ? "," + fail + " 只未取到" : ""), "ok");
    else toast("刷新失败,请检查网络或代码", "err");
    route();
  }

  /* ================= 路由 ================= */
  function route() {
    const h = location.hash || "#/";
    const m = h.match(/^#\/stock\/(\w+)$/);
    if (m) return viewStock(m[1]);
    if (h.startsWith("#/settings")) return viewSettings();
    viewOverview();
  }
  window.addEventListener("hashchange", route);
  function nav(name) {
    $$(".nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === name));
  }

  /* ================= 总览页(示例图布局) ================= */
  function viewOverview() {
    nav("home");
    const t = totals();
    app.innerHTML = `
      <div class="panel goal-panel">
        <div class="goal-head">
          <div><span class="t1">攒股收息</span><span class="t2">退休计划</span></div>
          <a class="btn ghost small" href="#/settings">编辑目标</a>
        </div>
        <div class="goal-mid">
          <div>
            <div class="g-label">当前年度股息总额</div>
            <div class="g-num">${fmt(t.annual)}</div>
          </div>
          <div class="g-right">
            <div class="g-pct ${t.pct >= 100 ? "reached" : ""}">${t.pct.toFixed(2)}%</div>
            <div class="g-target">目标 ${fmtInt(state.goal)}/年</div>
          </div>
        </div>
        <div class="bar"><i style="width:${Math.max(0, Math.min(100, t.pct))}%"></i></div>
        <div class="g-stats">
          <span>已收 <b>${fmt(t.rcvY)}</b></span><span class="dot">·</span>
          <span>成本 <b>${fmtWan(t.cost)}</b></span><span class="dot">·</span>
          <span>市值 <b>${fmtWan(t.mv)}</b></span><span class="dot">·</span>
          <span>还差 <b>${fmt(Math.max(0, t.gap))}</b></span>
        </div>
      </div>

      <div class="home-head">
        <h2><i></i>实际收息记录<span class="cnt">${state.stocks.length ? state.stocks.length + " 只" : ""}</span></h2>
        <div class="head-btns">
          <button class="btn ghost small" id="refresh-btn">刷新行情</button>
          <a class="btn small" href="#/stock/new">＋ 添加</a>
        </div>
      </div>

      ${state.stocks.length
        ? `<div class="grid">${state.stocks.map(stockHTML).join("")}</div>`
        : `<div class="empty">还没有收息标的<br><br><a class="btn" href="#/stock/new">＋ 添加第一只</a></div>`}
    `;
    $("#refresh-btn").onclick = refreshQuotes;
    $$(".stock").forEach(el => el.onclick = () => { location.hash = "#/stock/" + el.dataset.id; });
  }
  function stockHTML(s) {
    const shares = num(s.shares), cost = num(s.cost), price = num(s.price), dps = num(s.dps);
    const pl = price > 0 && cost > 0 ? (price - cost) / cost * 100 : null;
    const cy = price > 0 && dps > 0 ? dps / price * 100 : null;
    const coy = cost > 0 && dps > 0 ? dps / cost * 100 : null;
    const na = '<div class="v muted">--</div>';
    return `
      <div class="stock" data-id="${s.id}">
        <div class="srow1">
          <div class="scell"><div class="lb">收息标的</div><div class="v name">${esc(s.name) || "未命名"}</div></div>
          <div class="scell"><div class="lb">攒股数量</div><div class="v">${fmtQty(shares)}</div></div>
          <div class="scell"><div class="lb">当前股价</div><div class="v">${price > 0 ? fmtPx(price) : "--"}</div></div>
          <div class="scell"><div class="lb">持仓成本</div><div class="v">${cost > 0 ? fmtPx(cost) : "--"}</div></div>
        </div>
        <div class="srow2">
          <div class="scell"><div class="lb">近一年每股分红</div><div class="v">${fmt(dps, 3)}</div></div>
          <div class="scell"><div class="lb">当前股息率</div>${cy == null ? na : `<div class="v">${fmt(cy)}%</div>`}</div>
          <div class="scell"><div class="lb">成本股息率</div>${coy == null ? na : `<div class="v">${fmt(coy)}%</div>`}</div>
          <div class="scell"><div class="lb">盈亏比例</div>${pl == null ? na : `<div class="v ${pl >= 0 ? "pos" : "neg"}">${pl >= 0 ? "+" : ""}${fmt(pl)}%</div>`}</div>
          <div class="scell"><div class="lb">预计当年分红</div><div class="v est">${fmt(shares * dps)}</div></div>
        </div>
      </div>`;
  }

  /* ================= 标的页(新增/编辑 + 收息记录) ================= */
  function viewStock(id) {
    nav("home");
    const isNew = id === "new";
    const s = isNew ? null : state.stocks.find(x => x.id === id);
    if (!isNew && !s) { location.hash = "#/"; return; }

    app.innerHTML = `
      <a class="back" href="#/">← 返回总览</a>

      <div class="panel">
        <h3>${isNew ? "添加收息标的" : "编辑:" + (esc(s.name) || "标的")}</h3>
        <div class="form">
          <div class="grid2">
            <div class="field"><label>代码(选填,用于自动刷新行情)</label>
              <input id="f-code" value="${esc(s ? s.code : "")}" placeholder="如 601318 / 515100"></div>
            <div class="field"><label>名称 *</label>
              <input id="f-name" value="${esc(s ? s.name : "")}" placeholder="如 中国平安"></div>
          </div>
          <div class="grid2">
            <div class="field"><label>攒股数量(股)</label>
              <input id="f-shares" type="number" inputmode="decimal" step="any" value="${s ? s.shares ?? "" : ""}" placeholder="0"></div>
            <div class="field"><label>持仓成本(元/股)</label>
              <input id="f-cost" type="number" inputmode="decimal" step="any" value="${s ? s.cost ?? "" : ""}" placeholder="0"></div>
          </div>
          <div class="grid2">
            <div class="field"><label>当前股价(元)</label>
              <input id="f-price" type="number" inputmode="decimal" step="any" value="${s ? s.price ?? "" : ""}" placeholder="可自动刷新"></div>
            <div class="field"><label>近一年每股分红(元)</label>
              <input id="f-dps" type="number" inputmode="decimal" step="any" value="${s ? s.dps ?? "" : ""}" placeholder="0">
              <div class="hint">A 股公告常写「每10股派 X 元」,此处填每股口径(X ÷ 10)</div></div>
          </div>
          <div class="btn-row">
            ${!isNew ? '<button class="btn danger" id="del-btn">删除</button>' : ""}
            <button class="btn ghost" onclick="location.hash='#/'">取消</button>
            <button class="btn" id="save-btn">${isNew ? "添加" : "保存"}</button>
          </div>
        </div>
        <div id="div-fetch" style="margin-top:12px"></div>
      </div>

      ${!isNew ? `
      <div class="panel">
        <h3>收息记录<span class="tag">到账一笔记一笔</span></h3>
        <div id="rc-list">${rcListHTML(s)}</div>
        <div class="rc-add">
          <input class="d" id="r-date" type="date" value="${today()}">
          <input class="a" id="r-amt" type="number" inputmode="decimal" step="any" placeholder="金额">
          <input class="n" id="r-note" placeholder="备注(选填)">
          <button class="btn small" id="r-add-btn">记一笔</button>
        </div>
      </div>` : ""}
    `;

    $("#save-btn").onclick = () => {
      const name = $("#f-name").value.trim();
      const shares = num($("#f-shares").value);
      if (!name) return toast("请填写名称", "err");
      if (shares <= 0) return toast("请填写攒股数量", "err");
      const data = {
        code: $("#f-code").value.trim(),
        name, shares,
        cost: num($("#f-cost").value),
        price: num($("#f-price").value),
        dps: num($("#f-dps").value),
      };
      if (isNew) {
        const st = Object.assign({ id: uid(), receipts: [] }, data);
        state.stocks.push(st);
        save();
        toast("已添加 " + name, "ok");
        location.hash = "#/stock/" + st.id;
      } else {
        Object.assign(s, data);
        save();
        toast("已保存", "ok");
        viewStock(s.id);
      }
    };

    // 输完代码:自动识别名称(带出股价) + 分红取数
    if (!isNew && s.code) autoFetchDiv(s.code);
    $("#f-code").addEventListener("change", async () => {
      autoFetchDiv($("#f-code").value);
      const full = withPrefix($("#f-code").value);
      if (!full) return;
      const map = await quoteFetch([full]);
      const q = map[full];
      if (!q) return toast("没查到该代码,请核对", "err");
      if (!$("#f-name").value.trim() && q.name) {
        $("#f-name").value = q.name;
        toast("已识别:" + q.name, "ok");
      }
      if (!$("#f-price").value.trim() && q.price) $("#f-price").value = q.price;
    });

    if (!isNew) {
      $("#r-add-btn").onclick = () => {
        const amount = num($("#r-amt").value);
        if (amount <= 0) return toast("请填写收息金额", "err");
        s.receipts.push({ id: uid(), date: $("#r-date").value || today(), amount, note: $("#r-note").value.trim() });
        $("#r-amt").value = ""; $("#r-note").value = "";
        save();
        viewStock(s.id);
        toast("已记一笔收息 " + fmt(amount) + " 元", "ok");
      };
      $("#del-btn").onclick = () => confirmBox(
        "确定删除「" + (s.name || "未命名") + "」及其全部收息记录?此操作不可恢复。",
        () => {
          state.stocks = state.stocks.filter(x => x.id !== s.id);
          save();
          toast("已删除");
          location.hash = "#/";
        });
      $$("#rc-list .del").forEach(b => b.onclick = ev => {
        ev.stopPropagation();
        s.receipts = s.receipts.filter(r => r.id !== b.dataset.rid);
        save();
        viewStock(s.id);
        toast("已删除该笔收息");
      });
    }
  }
  function rcListHTML(s) {
    const list = (s.receipts || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) return `<div class="about-note">暂无记录</div>`;
    const total = list.reduce((a, r) => a + num(r.amount), 0);
    return list.map(r => `
      <div class="rc-item">
        <div class="meta">${esc(r.date)}${r.note ? ` <span class="note">${esc(r.note)}</span>` : ""}</div>
        <div class="right">
          <span class="amt">${fmt(r.amount)}</span>
          <button class="del" data-rid="${r.id}" title="删除">✕</button>
        </div>
      </div>`).join("")
      + `<div class="rc-total"><span>累计已收</span><b>${fmt(total)} 元</b></div>`;
  }

  /* ================= 设置页 ================= */
  function viewSettings() {
    nav("settings");
    const st = state.settings;
    app.innerHTML = `
      <div class="home-head"><h2><i></i>设置</h2></div>

      <div class="panel"><h3>年度股息目标</h3>
        <div class="form">
          <div class="field"><label>目标金额(元 / 年)</label>
            <input id="s-goal" type="number" inputmode="decimal" step="any" value="${state.goal}"></div>
          <div class="btn-row"><button class="btn" id="goal-btn">保存目标</button></div>
        </div>
      </div>

      <div class="panel"><h3>数据同步(Cloudflare)<span class="tag">电脑 / 手机互相同步</span></h3>
        <div class="form">
          <div class="field"><label>同步密钥</label>
            <input id="s-key" type="password" autocomplete="off" value="${esc(st.syncKey)}" placeholder="见部署电脑上的 同步密钥.txt">
            <div class="hint">每台设备填一次即可,各设备用同一个密钥</div></div>
          <div class="field"><label>同步地址(一般不用改)</label>
            <input id="s-url" value="${esc(st.syncUrl || "/api/sync")}"></div>
          <label class="chk"><input id="s-auto" type="checkbox" ${st.auto ? "checked" : ""}>
            自动同步(改动后自动上传,打开时自动拉取较新数据)</label>
          <div class="btn-row">
            <button class="btn ghost" id="sync-save-btn">保存同步设置</button>
            <button class="btn" id="sync-now-btn">立即同步</button>
          </div>
          <div class="syncstatus" id="sync-status"></div>
          <div class="hint" style="font-size:12px;color:var(--dim);line-height:1.5">数据存放在你自己 Cloudflare 账号的 KV 存储里,以最后修改时间为准</div>
        </div>
      </div>

      <div class="panel"><h3>安装到手机桌面</h3>
        <div class="btn-row"><button class="btn" id="install-btn" style="display:none">安装 App</button></div>
        <div class="hint" style="font-size:12px;color:var(--dim);line-height:1.5">用手机浏览器(需 https 网址)打开本页:安卓 Chrome 菜单选「添加到主屏幕/安装应用」;iPhone Safari 点分享按钮选「添加到主屏幕」</div>
      </div>

      <div class="panel"><h3>关于</h3>
        <div class="about-note">数据保存在本机浏览器;行情数据来自腾讯接口,仅供参考;分红请以券商到账为准</div>
      </div>
    `;

    $("#goal-btn").onclick = () => {
      const g = num($("#s-goal").value);
      if (g <= 0) return toast("请填写有效的目标金额", "err");
      state.goal = g;
      save();
      toast("目标已更新", "ok");
    };
    $("#sync-save-btn").onclick = () => {
      state.settings.syncKey = $("#s-key").value.trim();
      state.settings.syncUrl = $("#s-url").value.trim();
      state.settings.auto = $("#s-auto").checked;
      save();
      toast("同步设置已保存", "ok");
    };
    $("#sync-now-btn").onclick = () => { $("#sync-save-btn").onclick(); syncNow(true); };
    const ib = $("#install-btn");
    if (deferredPrompt) {
      ib.style.display = "";
      ib.onclick = async () => {
        deferredPrompt.prompt();
        const res = await deferredPrompt.userChoice.catch(() => null);
        if (res && res.outcome === "accepted") toast("已安装,可在桌面打开", "ok");
        deferredPrompt = null;
        ib.style.display = "none";
      };
    }
  }

  /* ================= 数据同步(Cloudflare Pages Function /api/sync) ================= */
  function syncUrl() { return state.settings.syncUrl || "/api/sync"; }
  async function fetchTimeout(url, opt) {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 15000);
    opt.signal = c.signal;
    try { return await fetch(url, opt); } finally { clearTimeout(timer); }
  }
  function setSyncStatus(msg, cls) {
    const el = $("#sync-status");
    if (el) { el.textContent = msg || ""; el.className = "syncstatus " + (cls || ""); }
  }
  function schedulePush() {
    if (!state.settings.auto || !state.settings.syncKey) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow(false), 3000);
  }
  async function syncNow(manual) {
    if (!state.settings.syncKey) { if (manual) toast("请先在设置里填写同步密钥", "err"); return; }
    const url = syncUrl();
    const H = { "X-Auth-Key": state.settings.syncKey };
    if (manual) setSyncStatus("同步中…");
    try {
      let remote = null;
      const r = await fetchTimeout(url, { headers: H });
      if (r.status === 401) throw new Error("密钥不正确");
      if (r.status !== 404) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        remote = await r.json();
      }
      if (remote && +remote.updatedAt > state.updatedAt) {
        state = migrate(remote);
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
        setSyncStatus("已拉取云端数据(云端较新)", "ok");
        if (manual) toast("已拉取云端较新数据", "ok");
        route();
      } else {
        const r2 = await fetchTimeout(url, {
          method: "PUT",
          headers: Object.assign({ "Content-Type": "application/json" }, H),
          body: JSON.stringify(state),
        });
        if (r2.status === 401) throw new Error("密钥不正确");
        if (!r2.ok) throw new Error("HTTP " + r2.status);
        setSyncStatus(remote ? "已上传本地数据(本地较新)" : "已首次上传到云端", "ok");
        if (manual) toast(remote ? "本地较新,已上传云端" : "已首次上传到云端", "ok");
      }
    } catch (e) {
      const msg = e.name === "AbortError" ? "请求超时" : e.message;
      setSyncStatus("同步失败:" + msg, "err");
      if (manual) toast("同步失败:" + msg, "err");
    }
  }

  /* ================= 启动 ================= */
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.settings.auto && state.settings.syncKey) {
      clearTimeout(pushTimer);
      syncNow(false);
    }
  });

  route();
  if (state.settings.auto && state.settings.syncKey) syncNow(false);

  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
