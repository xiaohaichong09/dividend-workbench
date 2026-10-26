/* 攒股收息 · 东方财富分红数据（仅 A 股；ETF / 场内基金提示手动填写） */
(function (App) {
  "use strict";

  const U = App.util;

  async function fetchDivHistory(code) {
    const clean = U.code6(code) || U.cleanCode(code).replace(/^(sh|sz|bj)/, "");
    if (!clean) return [];
    const url =
      "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET" +
      "&columns=SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,EX_DIVIDEND_DATE,PRETAX_BONUS_RMB,IMPL_PLAN_PROFILE,ASSIGN_PROGRESS" +
      "&filter=(SECURITY_CODE%3D%22" +
      encodeURIComponent(clean) +
      "%22)" +
      "&pageNumber=1&pageSize=40&sortTypes=-1&sortColumns=EX_DIVIDEND_DATE&source=WEB&client=WEB";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let json;
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const rows = (json && json.result && json.result.data) || [];
    const todayMs = Date.now();
    return rows
      .filter(
        (x) =>
          x.EX_DIVIDEND_DATE &&
          U.num(x.PRETAX_BONUS_RMB) > 0 &&
          String(x.ASSIGN_PROGRESS || "").indexOf("实施") >= 0 &&
          new Date(String(x.EX_DIVIDEND_DATE).slice(0, 10) + "T00:00:00").getTime() <= todayMs
      )
      .map((x) => ({
        date: String(x.EX_DIVIDEND_DATE).slice(0, 10),
        per10: U.num(x.PRETAX_BONUS_RMB),
        plan: x.IMPL_PLAN_PROFILE || "",
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /** 近 12 个月口径：窗口内每次分红合计；窗口内没有则取最近一次并标记 */
  function trailingDiv(rows) {
    if (!rows || !rows.length) return null;
    const now = new Date();
    const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime();
    const used = rows.filter((r) => new Date(r.date + "T00:00:00").getTime() >= from);
    if (used.length) {
      return {
        perShare: used.reduce((sum, r) => sum + r.per10, 0) / 10,
        used,
        fallback: false,
      };
    }
    return { perShare: rows[0].per10 / 10, used: [rows[0]], fallback: true };
  }

  function planText(row) {
    return row.plan || "每10股派 " + row.per10 + " 元";
  }

  function renderRows(data) {
    return data.used
      .map(
        (r) => `
        <div class="div-row">
          <span>${U.esc(r.date)}</span>
          <span class="plan">${U.esc(planText(r))}</span>
          <b>${(r.per10 / 10).toFixed(4)}</b>
        </div>`
      )
      .join("");
  }

  /**
   * 拉取并在页面上展示分红建议。
   * 输入框为空时自动填入；已有值时只给建议，避免覆盖用户手工修改。
   */
  async function renderSuggestion(options) {
    const opts = options || {};
    const box = opts.box;
    const input = opts.input;
    if (!box || !input) return null;

    const raw = opts.code;
    const full = U.withPrefix(raw);
    const code = U.code6(raw) || U.cleanCode(raw).replace(/^(sh|sz|bj)/, "");

    if (!code) {
      box.innerHTML = "";
      return null;
    }
    if (U.isFund(full)) {
      box.innerHTML =
        '<div class="about-note">ETF / 场内基金暂无公开的跨域分红接口，请按基金公告手动填写「每份分红」。</div>';
      return null;
    }

    box.innerHTML = '<div class="about-note loading-line"><span class="spinner"></span>正在获取分红数据…</div>';
    try {
      const rows = await fetchDivHistory(code);
      const data = trailingDiv(rows);
      if (!data) {
        box.innerHTML =
          '<div class="about-note">未查到 ' + U.esc(code) + " 的分红记录，请手动填写。</div>";
        return null;
      }

      const perShare = +data.perShare.toFixed(4);
      const old = U.num(input.value);
      const shouldFill = old <= 0;
      if (shouldFill) {
        input.value = perShare;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.classList.add("value-flash");
        setTimeout(() => input.classList.remove("value-flash"), 1200);
      }

      const diff = old > 0 && Math.abs(old - perShare) > 1e-9;
      box.innerHTML = `
        <div class="div-list">
          <div class="div-head">
            <span>分红明细</span>
            <span class="div-badge">近 12 个月</span>
          </div>
          ${renderRows(data)}
          <div class="div-sum">
            每股合计 <b>${perShare.toFixed(4)}</b> 元
            ${
              shouldFill
                ? '<span class="div-filled">已填入</span>'
                : diff
                ? `<button type="button" class="btn ghost small" id="apply-dps">用 ${perShare.toFixed(4)} 替换当前值</button>`
                : '<span class="div-same">与当前填写一致</span>'
            }
            ${
              data.fallback
                ? `<div class="about-note warn">近 12 个月没有分红，已取最近一次（${U.esc(
                    data.used[0].date
                  )}）供参考。</div>`
                : ""
            }
          </div>
        </div>`;

      const apply = box.querySelector("#apply-dps");
      if (apply) {
        apply.addEventListener("click", () => {
          input.value = perShare;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          apply.replaceWith(
            Object.assign(document.createElement("span"), {
              className: "div-same",
              textContent: "已替换",
            })
          );
        });
      }
      return { perShare, data };
    } catch (e) {
      const message =
        e && e.name === "AbortError" ? "超时" : (e && e.message) || "网络错误";
      box.innerHTML =
        '<div class="about-note warn">分红取数失败（' + U.esc(message) + "），请手动填写。</div>";
      return null;
    }
  }

  App.dividends = { fetchDivHistory, trailingDiv, renderSuggestion };
})(window.App = window.App || {});
