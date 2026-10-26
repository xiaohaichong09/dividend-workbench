/* 攒股收息 · 总览页 */
(function (App) {
  "use strict";

  const U = App.util;

  function stockHTML(st) {
    const shares = U.num(st.shares);
    const cost = U.num(st.cost);
    const price = U.num(st.price);
    const dps = U.num(st.dps);
    const pl = price > 0 && cost > 0 ? ((price - cost) / cost) * 100 : null;
    const currentYield = price > 0 && dps > 0 ? (dps / price) * 100 : null;
    const costYield = cost > 0 && dps > 0 ? (dps / cost) * 100 : null;
    const annual = shares * dps;
    const receipts = (st.receipts || []).length;

    const empty = '<div class="v muted">--</div>';
    const code = st.code ? U.esc(st.code) : "未填代码";

    return `
      <article class="stock" data-id="${U.esc(st.id)}" role="button" tabindex="0"
        aria-label="编辑 ${U.esc(st.name || "未命名标的")}">
        <div class="srow1">
          <div class="scell name-cell">
            <div class="lb">收息标的</div>
            <div class="v name">${U.esc(st.name) || "未命名"}</div>
            <div class="code">${code}${receipts ? " · 已收 " + receipts + " 笔" : ""}</div>
          </div>
          <div class="scell"><div class="lb">攒股数量</div><div class="v">${U.fmtQty(shares)}</div></div>
          <div class="scell"><div class="lb">当前股价</div><div class="v">${price > 0 ? U.fmtPx(price) : "--"}</div></div>
          <div class="scell"><div class="lb">持仓成本</div><div class="v">${cost > 0 ? U.fmtPx(cost) : "--"}</div></div>
        </div>
        <div class="srow2">
          <div class="scell"><div class="lb">近一年每股分红</div><div class="v">${U.fmt(dps, 3)}</div></div>
          <div class="scell"><div class="lb">当前股息率</div>${
            currentYield == null ? empty : '<div class="v">' + U.fmt(currentYield) + "%</div>"
          }</div>
          <div class="scell"><div class="lb">成本股息率</div>${
            costYield == null ? empty : '<div class="v">' + U.fmt(costYield) + "%</div>"
          }</div>
          <div class="scell"><div class="lb">盈亏比例</div>${
            pl == null
              ? empty
              : '<div class="v ' +
                (pl >= 0 ? "pos" : "neg") +
                '">' +
                (pl >= 0 ? "+" : "") +
                U.fmt(pl) +
                "%</div>"
          }</div>
          <div class="scell"><div class="lb">预计当年分红</div><div class="v est">${U.fmt(annual)}</div></div>
        </div>
      </article>`;
  }

  function closedHTML(st) {
    const received = (st.receipts || []).reduce((sum, r) => sum + U.num(r.amount), 0);
    const sells = (st.trades || []).filter((x) => x.type === "sell");
    const realized = sells.reduce((sum, x) => sum + U.num(x.realized), 0);
    const last = sells.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const code = st.code ? U.esc(st.code) : "未填代码";

    return `
      <a class="closed-item" href="#/stock/${encodeURIComponent(st.id)}">
        <div class="closed-main">
          <b>${U.esc(st.name) || "未命名"}</b>
          <span>${code} · 已清仓${last ? " · " + U.esc(last.date) : ""}</span>
        </div>
        <div class="closed-nums">
          <span>累计收息 <b>¥ ${U.fmt(received)}</b></span>
          <span>已实现 <b class="${realized >= 0 ? "pos" : "neg"}">${realized >= 0 ? "+" : ""}¥ ${U.fmt(
      realized
    )}</b></span>
        </div>
      </a>`;
  }

  function render() {
    const app = document.getElementById("app");
    const t = App.store.totals();
    const year = new Date().getFullYear();
    const settings = App.store.state.settings || {};
    const configured = !!String(settings.syncKey || "").trim();
    const pct = Math.max(0, Math.min(100, t.pct));
    const activeStocks = App.store.state.stocks.filter((st) => U.num(st.shares) > 0);
    const closedStocks = App.store.state.stocks.filter((st) => U.num(st.shares) <= 0);

    app.innerHTML = `
      <section class="panel goal-panel" aria-label="年度股息目标">
        <div class="goal-head">
          <div class="goal-title">
            <span class="logo-mark" aria-hidden="true">▍</span>
            <div>
              <div class="t1">攒股收息</div>
              <div class="t2">退休计划 · ${year} 年度</div>
            </div>
          </div>
          <a class="btn ghost small" href="#/settings">编辑目标</a>
        </div>

        <div class="goal-mid">
          <div class="goal-main">
            <div class="g-label">当前年度股息总额</div>
            <div class="g-num"><span class="cur">¥</span>${U.fmt(t.annual)}</div>
            <div class="g-sub">已到账 ${U.fmt(t.receivedYear)} 元 · 累计 ${U.fmt(t.receivedAll)} 元</div>
          </div>
          <div class="g-right">
            <div class="g-pct ${t.pct >= 100 ? "reached" : ""}">${t.pct.toFixed(2)}<span>%</span></div>
            <div class="g-target">目标 ${U.fmtInt(App.store.state.goal)} / 年</div>
          </div>
        </div>

        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"
          aria-valuenow="${t.pct.toFixed(2)}"><i style="width:${pct}%"></i></div>

        <div class="g-stats">
          <div class="g-stat"><span>已收</span><b>${U.fmt(t.receivedYear)}</b></div>
          <div class="g-stat"><span>成本</span><b>${U.fmtWan(t.cost)}</b></div>
          <div class="g-stat"><span>市值</span><b>${U.fmtWan(t.marketValue)}</b></div>
          <div class="g-stat"><span>还差</span><b>${U.fmt(Math.max(0, t.gap))}</b></div>
          <div class="g-stat"><span>持仓</span><b>${t.count} 只</b></div>
          <div class="g-stat"><span>成本股息率</span><b>${t.cost > 0 ? U.fmt(t.yieldOnCost) + "%" : "--"}</b></div>
        </div>
      </section>

      ${
        configured
          ? ""
          : `<div class="notice">
              <span>还没有配置数据同步，换设备会看不到这里的记录。</span>
              <a href="#/settings">去设置 →</a>
            </div>`
      }

      <div class="home-head">
        <h2><i></i>持仓与收息<span class="cnt">${t.count ? t.count + " 只" : ""}</span></h2>
        <div class="head-btns">
          <button class="btn ghost small" id="refresh-btn" type="button">↻ 刷新行情</button>
          <a class="btn small" href="#/stock/new">＋ 添加</a>
        </div>
      </div>

      ${
        activeStocks.length
          ? `<div class="grid">${activeStocks.map(stockHTML).join("")}</div>`
          : t.totalCount === 0
          ? `<div class="empty">
              <div class="empty-icon">◎</div>
              <div class="empty-title">还没有收息标的</div>
              <div class="empty-sub">添加第一只股票，开始记录你的退休现金流。</div>
              <a class="btn" href="#/stock/new">＋ 添加第一只</a>
            </div>`
          : `<div class="notice">
              <span>当前没有持仓，已清仓标的的收息记录仍保留在下方。</span>
              <a href="#/stock/new">＋ 添加新标的</a>
            </div>`
      }

      ${
        closedStocks.length
          ? `<div class="home-head closed-head">
              <h2><i></i>已清仓<span class="cnt">${closedStocks.length} 只</span></h2>
              <span class="closed-hint">历史收息与已实现盈亏都会保留</span>
            </div>
            <div class="closed-list">${closedStocks.map(closedHTML).join("")}</div>`
          : ""
      }

      <div class="page-foot">
        行情来自腾讯，分红数据来自东方财富，仅供参考 · 请以券商到账为准
      </div>
    `;

    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        App.ui.setBusy(refreshBtn, true, "刷新中…");
        try {
          await App.quotes.refreshAll();
        } finally {
          App.ui.setBusy(refreshBtn, false);
          render();
        }
      });
    }

    U.$$(".stock").forEach((el) => {
      const go = () => {
        location.hash = "#/stock/" + encodeURIComponent(el.dataset.id);
      };
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
  }

  App.views = App.views || {};
  App.views.overview = { render };
})(window.App = window.App || {});
