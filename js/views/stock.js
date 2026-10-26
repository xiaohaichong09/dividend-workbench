/* 攒股收息 · 标的编辑 + 收息记录 */
(function (App) {
  "use strict";

  const U = App.util;
  const $ = U.$;

  function stockStats(st) {
    const shares = U.num(st.shares);
    const cost = U.num(st.cost);
    const price = U.num(st.price);
    const dps = U.num(st.dps);
    const annual = shares * dps;
    const pl = price > 0 && cost > 0 ? ((price - cost) / cost) * 100 : null;
    const currentYield = price > 0 && dps > 0 ? (dps / price) * 100 : null;
    const costYield = cost > 0 && dps > 0 ? (dps / cost) * 100 : null;
    const received = (st.receipts || []).reduce((sum, r) => sum + U.num(r.amount), 0);
    const sells = (st.trades || []).filter((t) => t.type === "sell");
    const realized = sells.reduce((sum, t) => sum + U.num(t.realized), 0);

    const stat = (label, value, cls) =>
      `<div class="mini-stat"><span>${label}</span><b class="${cls || ""}">${value}</b></div>`;

    return `
      <div class="mini-stats">
        ${stat("当前股息率", currentYield == null ? "--" : U.fmt(currentYield) + "%")}
        ${stat("成本股息率", costYield == null ? "--" : U.fmt(costYield) + "%")}
        ${stat(
          "盈亏比例",
          pl == null ? "--" : (pl >= 0 ? "+" : "") + U.fmt(pl) + "%",
          pl == null ? "" : pl >= 0 ? "pos" : "neg"
        )}
        ${stat("预计年分红", U.fmt(annual), "est")}
        ${stat("累计已收", U.fmt(received))}
        ${stat(
          "已实现盈亏",
          sells.length ? (realized >= 0 ? "+" : "") + U.fmt(realized) : "--",
          sells.length ? (realized >= 0 ? "pos" : "neg") : ""
        )}
      </div>`;
  }

  function tradesHTML(st) {
    const list = (st.trades || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) {
      return '<div class="about-note empty-note">还没有仓位变动。加仓 / 减仓后会在这里留痕；清仓不会删除历史收息。</div>';
    }
    return (
      '<div class="trade-list">' +
      list
        .map(
          (t) => `
        <div class="trade-item">
          <div class="trade-meta">
            <span class="trade-tag ${t.type}">${t.type === "buy" ? "加仓" : "减仓"}</span>
            <span class="date">${U.esc(t.date)}</span>
            ${t.note ? `<span class="note">${U.esc(t.note)}</span>` : ""}
          </div>
          <div class="trade-right">
            <span>${U.fmtQty(t.shares)} 股 @ ${U.fmtPx(t.price)}</span>
            ${
              t.type === "sell"
                ? `<b class="${U.num(t.realized) >= 0 ? "pos" : "neg"}">${
                    U.num(t.realized) >= 0 ? "+" : ""
                  }¥ ${U.fmt(t.realized)}</b>`
                : ""
            }
          </div>
        </div>`
        )
        .join("") +
      "</div>"
    );
  }

  function receiptsHTML(st) {
    const list = (st.receipts || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) {
      return '<div class="about-note empty-note">还没有收息记录。到账后记一笔，年度「已收」会自动累计。</div>';
    }
    const total = list.reduce((sum, r) => sum + U.num(r.amount), 0);
    return (
      list
        .map(
          (r) => `
        <div class="rc-item">
          <div class="meta">
            <span class="date">${U.esc(r.date)}</span>
            ${r.note ? `<span class="note">${U.esc(r.note)}</span>` : ""}
          </div>
          <div class="right">
            <span class="amt">+${U.fmt(r.amount)}</span>
            <button class="del" type="button" data-rid="${U.esc(r.id)}" aria-label="删除这笔收息">✕</button>
          </div>
        </div>`
        )
        .join("") +
      `<div class="rc-total"><span>累计已收</span><b>¥ ${U.fmt(total)}</b></div>`
    );
  }

  function render(id) {
    const app = document.getElementById("app");
    const isNew = id === "new";
    const st = isNew ? null : App.store.getStock(id);
    if (!isNew && !st) {
      location.hash = "#/";
      return;
    }

    const title = isNew ? "添加收息标的" : st.name || "未命名标的";

    app.innerHTML = `
      <a class="back" href="#/">← 返回总览</a>

      ${
        !isNew && U.num(st.shares) <= 0
          ? '<div class="closed-banner">已清仓 · 历史收息和已实现盈亏都会保留；之后到账的分红仍可继续记录。</div>'
          : ""
      }

      <section class="panel stock-editor">
        <div class="panel-head">
          <h2>${isNew ? "添加收息标的" : "编辑 · " + U.esc(title)}</h2>
          ${isNew ? "" : '<span class="tag">' + (st.receipts || []).length + " 笔收息</span>"}
        </div>

        <form id="stock-form" class="form" novalidate>
          <div class="grid2">
            <div class="field">
              <label for="f-code">代码 <span class="opt">选填，用于自动刷新行情</span></label>
              <input id="f-code" value="${st ? U.esc(st.code) : ""}" inputmode="numeric"
                maxlength="8" placeholder="如 601318 / 515100" autocomplete="off">
              <div class="hint" id="code-status">输入 6 位代码会自动识别名称并获取分红</div>
            </div>
            <div class="field">
              <label for="f-name">名称 <span class="req">*</span></label>
              <input id="f-name" value="${st ? U.esc(st.name) : ""}" placeholder="如 中国平安"
                autocomplete="off" required>
            </div>
          </div>

          <div class="grid2">
            <div class="field">
              <label for="f-shares">攒股数量（股）</label>
              <input id="f-shares" type="number" inputmode="decimal" step="any"
                value="${st ? st.shares ?? "" : ""}" placeholder="0" required>
            </div>
            <div class="field">
              <label for="f-cost">持仓成本（元/股）</label>
              <input id="f-cost" type="number" inputmode="decimal" step="any"
                value="${st ? st.cost ?? "" : ""}" placeholder="0">
            </div>
          </div>

          <div class="grid2">
            <div class="field">
              <label for="f-price">当前股价（元）</label>
              <input id="f-price" type="number" inputmode="decimal" step="any"
                value="${st ? st.price ?? "" : ""}" placeholder="可自动刷新">
            </div>
            <div class="field">
              <label for="f-dps">近一年每股分红（元）</label>
              <input id="f-dps" type="number" inputmode="decimal" step="any"
                value="${st ? st.dps ?? "" : ""}" placeholder="0">
              <div class="hint">A 股公告常写「每 10 股派 X 元」，这里填每股口径（X ÷ 10）</div>
            </div>
          </div>

          <div id="div-fetch" class="div-fetch"></div>

          <div class="btn-row form-actions">
            ${!isNew ? '<button class="btn danger ghost" type="button" id="del-btn">删除标的</button>' : ""}
            <span class="spacer"></span>
            <a class="btn ghost" href="#/">取消</a>
            <button class="btn" type="submit" id="save-btn">${isNew ? "添加" : "保存修改"}</button>
          </div>
        </form>
      </section>

      ${
        !isNew
          ? `${stockStats(st)}
      <section class="panel">
        <div class="panel-head">
          <h2>仓位变动</h2>
          <span class="tag">当前 ${U.fmtQty(st.shares)} 股 · 成本 ${
              U.num(st.cost) > 0 ? U.fmtPx(st.cost) : "--"
            }</span>
        </div>
        <div class="form">
          <div class="hint">加仓会重新计算持仓成本；减仓按当前成本计算已实现盈亏。减到 0 股即为清仓，历史收息不会删除。</div>
          <form class="trade-add" id="trade-form" novalidate>
            <select class="t" id="t-type" aria-label="变动类型">
              <option value="buy">加仓</option>
              <option value="sell">减仓 / 卖出</option>
            </select>
            <input class="d" id="t-date" type="date" value="${U.today()}" aria-label="成交日期">
            <input class="s" id="t-shares" type="number" inputmode="decimal" step="any"
              placeholder="数量" aria-label="成交数量">
            <input class="p" id="t-price" type="number" inputmode="decimal" step="any"
              placeholder="成交价" aria-label="成交价">
            <input class="f" id="t-fee" type="number" inputmode="decimal" step="any"
              placeholder="手续费" aria-label="手续费">
            <input class="n" id="t-note" maxlength="40" placeholder="备注（选填）" aria-label="备注">
            <button class="btn small" type="submit" id="t-add-btn">记一笔</button>
          </form>
          <div id="trade-list">${tradesHTML(st)}</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>收息记录</h2>
          <span class="tag">到账一笔记一笔</span>
        </div>
        <div id="rc-list">${receiptsHTML(st)}</div>
        <form class="rc-add" id="receipt-form" novalidate>
          <input class="d" id="r-date" type="date" value="${U.today()}" aria-label="到账日期">
          <input class="a" id="r-amt" type="number" inputmode="decimal" step="any"
            placeholder="金额" aria-label="收息金额">
          <input class="n" id="r-note" maxlength="40" placeholder="备注（选填）" aria-label="备注">
          <button class="btn small" type="submit" id="r-add-btn">记一笔</button>
        </form>
      </section>`
          : ""
      }
    `;

    const form = $("#stock-form");
    const codeInput = $("#f-code");
    const nameInput = $("#f-name");
    const sharesInput = $("#f-shares");
    const priceInput = $("#f-price");
    const dpsInput = $("#f-dps");
    const divBox = $("#div-fetch");
    const codeStatus = $("#code-status");

    let lastLookup = "";
    let lookingUp = false;
    let codeTimer = null;

    async function lookupCode(silent) {
      const code = codeInput.value.trim();
      const full = U.withPrefix(code);
      if (!full) {
        divBox.innerHTML = "";
        codeStatus.textContent = code ? "代码格式不完整（需要 6 位数字）" : "输入 6 位代码会自动识别名称并获取分红";
        return;
      }
      const key = full + "|" + dpsInput.value;
      if (lookingUp || key === lastLookup) return;
      lookingUp = true;
      lastLookup = key;

      try {
        const quote = await App.quotes.lookup(code);
        if (quote) {
          let recognized = false;
          if (!nameInput.value.trim() && quote.name) {
            nameInput.value = quote.name;
            recognized = true;
          }
          if (!priceInput.value.trim() && quote.price) {
            priceInput.value = quote.price;
            recognized = true;
          }
          codeStatus.textContent = quote.name
            ? "已识别：" + quote.name + (quote.price ? " · " + quote.price.toFixed(2) : "")
            : "已获取行情";
          if (recognized && !silent) App.ui.toast("已识别 " + (quote.name || "该标的"), "ok");
        } else if (silent) {
          codeStatus.textContent = "没有查到该代码的行情，可手动填写";
        }
      } catch (e) {
        if (!silent) App.ui.toast("行情获取失败，可手动填写", "err");
      }

      await App.dividends.renderSuggestion({
        code,
        box: divBox,
        input: dpsInput,
        currentDps: dpsInput.value,
      });
      lookingUp = false;
    }

    codeInput.addEventListener("input", () => {
      clearTimeout(codeTimer);
      const code = codeInput.value.trim();
      if (!U.code6(code)) {
        codeStatus.textContent = "输入 6 位代码会自动识别名称并获取分红";
        return;
      }
      codeTimer = setTimeout(() => lookupCode(false), 600);
    });

    codeInput.addEventListener("change", () => {
      clearTimeout(codeTimer);
      lastLookup = "";
      lookupCode(false);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const shares = U.num(sharesInput.value);
      if (!name) {
        App.ui.toast("请填写名称", "err");
        nameInput.focus();
        return;
      }
      if (shares <= 0) {
        App.ui.toast("请填写攒股数量", "err");
        sharesInput.focus();
        return;
      }

      const data = {
        code: codeInput.value.trim(),
        name,
        shares,
        cost: U.num($("#f-cost").value),
        price: U.num(priceInput.value),
        dps: U.num(dpsInput.value),
      };

      if (isNew) {
        const created = App.store.addStock(data);
        App.ui.toast("已添加 " + name, "ok");
        location.hash = "#/stock/" + encodeURIComponent(created.id);
      } else {
        App.store.updateStock(st.id, data);
        App.ui.toast("已保存", "ok");
        render(st.id);
      }
    });

    const delBtn = $("#del-btn");
    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        const receipts = (st.receipts || []).length;
        const trades = (st.trades || []).length;
        let message = "确定彻底删除「" + (st.name || "未命名") + "」？";
        if (receipts || trades) {
          message +=
            "将同时删除 " +
            receipts +
            " 笔收息记录和 " +
            trades +
            " 笔仓位变动，且不可恢复。如果只是卖出股票，请用上方的「减仓 / 卖出」，历史数据会保留。";
        }
        const ok = await App.ui.confirm(message, { okText: "彻底删除" });
        if (!ok) return;
        App.store.deleteStock(st.id);
        App.ui.toast("已删除");
        location.hash = "#/";
      });
    }

    // 打开已有标的时：若已有代码，自动获取一次行情/分红建议
    if (!isNew && st.code) {
      if (!U.num(priceInput.value)) lookupCode(true);
      else {
        App.dividends.renderSuggestion({
          code: st.code,
          box: divBox,
          input: dpsInput,
          currentDps: dpsInput.value,
        });
      }
    }

    /* ---------- 仓位变动 ---------- */
    if (!isNew) {
      const tradeForm = $("#trade-form");
      tradeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const type = $("#t-type").value;
        const result = App.store.addTrade(st.id, {
          type,
          date: $("#t-date").value || U.today(),
          shares: $("#t-shares").value,
          price: $("#t-price").value,
          fee: $("#t-fee").value,
          note: $("#t-note").value.trim(),
        });
        if (result.error) {
          App.ui.toast(result.error, "err");
          return;
        }
        if (type === "sell" && U.num(result.stock.shares) <= 0) {
          App.ui.toast("已清仓，历史收息和已实现盈亏已保留", "ok");
        } else {
          App.ui.toast(type === "sell" ? "已记录减仓" : "已记录加仓", "ok");
        }
        render(st.id);
      });
    }

    /* ---------- 收息记录 ---------- */
    if (!isNew) {
      const receiptForm = $("#receipt-form");
      const amountInput = $("#r-amt");
      const noteInput = $("#r-note");
      const dateInput = $("#r-date");

      receiptForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const amount = U.num(amountInput.value);
        if (amount <= 0) {
          App.ui.toast("请填写收息金额", "err");
          amountInput.focus();
          return;
        }
        const receipt = App.store.addReceipt(st.id, {
          date: dateInput.value || U.today(),
          amount,
          note: noteInput.value.trim(),
        });
        if (!receipt) {
          App.ui.toast("日期或金额不正确", "err");
          return;
        }
        App.ui.toast("已记一笔收息 " + U.fmt(amount) + " 元", "ok");
        render(st.id);
      });

      const rcList = $("#rc-list");
      rcList.addEventListener("click", async (e) => {
        const btn = e.target.closest(".del");
        if (!btn) return;
        const ok = await App.ui.confirm("删除这笔收息记录？", { okText: "删除" });
        if (!ok) return;
        App.store.deleteReceipt(st.id, btn.dataset.rid);
        App.ui.toast("已删除该笔收息");
        render(st.id);
      });
    }
  }

  App.views = App.views || {};
  App.views.stock = { render };
})(window.App = window.App || {});
