/* 攒股收息 · 数据层：本地状态、迁移、统计与备份（挂载到 window.App.store） */
(function (App) {
  "use strict";

  const U = App.util;
  const LS_KEY = "gzsx_state_v1";
  const BACKUP_KEY = "gzsx_backup_v1";
  const META_KEY = "gzsx_sync_meta_v1";
  const SCHEMA = 3;
  const DEFAULT_GOAL = 200000;

  const listeners = Object.create(null);
  function on(event, fn) {
    (listeners[event] || (listeners[event] = [])).push(fn);
    return () => {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
    };
  }
  function emit(event, payload) {
    (listeners[event] || []).slice().forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error("[bus]", event, e);
      }
    });
  }

  function safeParse(raw) {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("本地数据解析失败", e);
      return null;
    }
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      emit("storage:error", e);
      return false;
    }
  }

  function roundQty(value) {
    return Math.round((U.num(value) || 0) * 1e6) / 1e6;
  }

  function normalizeTrade(raw) {
    if (!raw || typeof raw !== "object") return null;
    const date = String(raw.date || "").slice(0, 10);
    const type = raw.type === "sell" ? "sell" : raw.type === "buy" ? "buy" : "";
    const shares = roundQty(raw.shares);
    const price = U.num(raw.price);
    const fee = Math.max(0, U.num(raw.fee));
    if (!type || !/^\d{4}-\d{2}-\d{2}$/.test(date) || shares <= 0) return null;

    const trade = {
      id: String(raw.id || U.uid()),
      date,
      type,
      shares,
      price,
      fee,
      note: String(raw.note || "").slice(0, 120),
    };
    if (type === "sell") {
      trade.costBasis = Math.max(0, U.num(raw.costBasis));
      trade.realized =
        raw.realized != null && Number.isFinite(Number(raw.realized))
          ? Number(raw.realized)
          : Math.round(((price - trade.costBasis) * shares - fee) * 100) / 100;
    }
    return trade;
  }

  function normalizeReceipt(raw) {
    if (!raw || typeof raw !== "object") return null;
    const date = String(raw.date || "").slice(0, 10);
    const amount = U.num(raw.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || amount <= 0) return null;
    return {
      id: String(raw.id || U.uid()),
      date,
      amount,
      note: String(raw.note || "").slice(0, 120),
    };
  }

  /**
   * 兼容旧版本数据：补齐字段、过滤脏数据、修复重复 id。
   * 数据格式保持向后兼容（LS_KEY 不变）。
   */
  function migrate(input) {
    const s = input && typeof input === "object" ? input : {};
    s.schema = SCHEMA;
    s.goal = Math.max(0, U.num(s.goal) || DEFAULT_GOAL);
    s.stocks = Array.isArray(s.stocks) ? s.stocks.filter((x) => x && typeof x === "object") : [];

    const seen = new Set();
    s.stocks.forEach((st) => {
      let id = String(st.id || U.uid());
      if (seen.has(id)) id = U.uid();
      seen.add(id);
      st.id = id;
      st.code = String(st.code || "").trim();
      st.name = String(st.name || "").trim();
      st.shares = Math.max(0, U.num(st.shares));
      st.cost = Math.max(0, U.num(st.cost));
      st.price = Math.max(0, U.num(st.price));
      st.dps = Math.max(0, U.num(st.dps));
      const tradeIds = new Set();
      st.trades = (Array.isArray(st.trades) ? st.trades : [])
        .map(normalizeTrade)
        .filter(Boolean)
        .map((t) => {
          if (tradeIds.has(t.id)) t.id = U.uid();
          tradeIds.add(t.id);
          return t;
        });
      const receiptIds = new Set();
      st.receipts = (Array.isArray(st.receipts) ? st.receipts : [])
        .map(normalizeReceipt)
        .filter(Boolean)
        .map((r) => {
          if (receiptIds.has(r.id)) r.id = U.uid();
          receiptIds.add(r.id);
          return r;
        });
    });

    const sSettings = s.settings && typeof s.settings === "object" ? s.settings : {};
    s.settings = {
      syncUrl: String(sSettings.syncUrl || "").trim(),
      syncKey: String(sSettings.syncKey || "").trim(),
      auto: sSettings.auto !== false,
    };
    s.updatedAt = Number(s.updatedAt) || 0;
    return s;
  }

  function load() {
    const raw = safeGet(LS_KEY);
    return migrate(safeParse(raw) || {});
  }

  const state = load();
  let stateListenersReady = false;

  function save(options) {
    const opts = options || {};
    if (opts.touch !== false) state.updatedAt = Date.now();
    const ok = safeSet(LS_KEY, JSON.stringify(state));
    if (!ok) {
      emit("storage:error", new Error("本地存储写入失败，可能是空间不足或浏览器隐私模式"));
    }
    if (opts.silent !== true) emit("state:saved", state);
    if (opts.push !== false && App.sync && App.sync.schedulePush) App.sync.schedulePush();
    return ok;
  }

  /** 用云端状态替换本地（不触发上传） */
  function replace(next, options) {
    const opts = options || {};
    if (opts.backup !== false) backup("pull");
    const migrated = migrate(next);
    // 同步配置属于每台设备：导入 / 云端覆盖时保留本机设置（尤其是同步密钥）
    if (opts.preserveSettings) migrated.settings = Object.assign({}, state.settings);
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, migrated);
    safeSet(LS_KEY, JSON.stringify(state));
    emit("state:replaced", state);
    return state;
  }

  function totals(input) {
    const s = input || state;
    const year = String(new Date().getFullYear());
    let annual = 0;
    let cost = 0;
    let marketValue = 0;
    let receivedYear = 0;
    let receivedAll = 0;
    let receipts = 0;
    let realized = 0;
    let activeCount = 0;
    let closedCount = 0;

    for (const st of s.stocks) {
      annual += U.num(st.shares) * U.num(st.dps);
      cost += U.num(st.shares) * U.num(st.cost);
      marketValue += U.num(st.shares) * U.num(st.price);
      if (U.num(st.shares) > 0) activeCount += 1;
      else closedCount += 1;
      for (const t of st.trades || []) {
        if (t.type === "sell") realized += U.num(t.realized);
      }
      for (const r of st.receipts || []) {
        const amount = U.num(r.amount);
        receivedAll += amount;
        receipts += 1;
        if (String(r.date).startsWith(year)) receivedYear += amount;
      }
    }

    const goal = U.num(s.goal);
    return {
      annual,
      cost,
      marketValue,
      receivedYear,
      receivedAll,
      receipts,
      realized,
      gap: goal - annual,
      pct: goal > 0 ? (annual / goal) * 100 : 0,
      yieldOnCost: cost > 0 ? (annual / cost) * 100 : 0,
      yieldOnPrice: marketValue > 0 ? (annual / marketValue) * 100 : 0,
      count: activeCount,
      activeCount,
      closedCount,
      totalCount: s.stocks.length,
    };
  }

  function getStock(id) {
    return state.stocks.find((x) => x.id === id) || null;
  }

  function addStock(data) {
    const st = migrate({
      stocks: [
        {
          id: U.uid(),
          code: data.code,
          name: data.name,
          shares: data.shares,
          cost: data.cost,
          price: data.price,
          dps: data.dps,
          receipts: [],
        },
      ],
    }).stocks[0];
    state.stocks.push(st);
    save();
    return st;
  }

  function updateStock(id, data) {
    const st = getStock(id);
    if (!st) return null;
    Object.assign(st, {
      code: String(data.code || "").trim(),
      name: String(data.name || "").trim(),
      shares: Math.max(0, U.num(data.shares)),
      cost: Math.max(0, U.num(data.cost)),
      price: Math.max(0, U.num(data.price)),
      dps: Math.max(0, U.num(data.dps)),
    });
    save();
    return st;
  }

  function deleteStock(id) {
    const before = state.stocks.length;
    state.stocks = state.stocks.filter((x) => x.id !== id);
    if (state.stocks.length !== before) save();
    return state.stocks.length !== before;
  }

  function addReceipt(stockId, data) {
    const st = getStock(stockId);
    if (!st) return null;
    const receipt = normalizeReceipt({
      id: U.uid(),
      date: data.date || U.today(),
      amount: data.amount,
      note: data.note,
    });
    if (!receipt) return null;
    st.receipts.push(receipt);
    save();
    return receipt;
  }

  /**
   * 记录一次仓位变动（加仓 / 减仓）。
   * - 加仓：按成交金额加权更新持仓成本
   * - 减仓：持仓成本不变，卖出部分按当前成本计算已实现盈亏
   * - 减到 0 即为清仓，标的和历史收息记录都会保留
   */
  function addTrade(stockId, data) {
    const st = getStock(stockId);
    if (!st) return { error: "标的不存在" };

    const type = data.type === "sell" ? "sell" : "buy";
    const date = String(data.date || U.today()).slice(0, 10);
    const shares = roundQty(data.shares);
    const price = U.num(data.price);
    const fee = Math.max(0, U.num(data.fee));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "日期格式不正确" };
    if (!(shares > 0)) return { error: "请填写变动数量" };
    if (!(price > 0)) return { error: "请填写成交价" };
    if (type === "sell" && shares > U.num(st.shares) + 1e-9) {
      return { error: "减仓数量不能超过当前持仓" };
    }

    const trade = {
      id: U.uid(),
      date,
      type,
      shares,
      price,
      fee,
      note: String(data.note || "").trim().slice(0, 120),
    };

    if (type === "sell") {
      trade.costBasis = U.num(st.cost);
      trade.realized = Math.round(((price - trade.costBasis) * shares - fee) * 100) / 100;
      st.shares = roundQty(U.num(st.shares) - shares);
      if (st.shares < 1e-9) st.shares = 0;
    } else {
      const oldShares = U.num(st.shares);
      const oldCost = U.num(st.cost);
      const totalShares = roundQty(oldShares + shares);
      st.cost =
        totalShares > 0
          ? Math.round(((oldShares * oldCost + shares * price + fee) / totalShares) * 1e6) / 1e6
          : price;
      st.shares = totalShares;
    }

    st.trades.push(trade);
    save();
    return { trade, stock: st };
  }

  function deleteReceipt(stockId, receiptId) {
    const st = getStock(stockId);
    if (!st) return false;
    const before = st.receipts.length;
    st.receipts = st.receipts.filter((r) => r.id !== receiptId);
    if (st.receipts.length !== before) save();
    return st.receipts.length !== before;
  }

  function setGoal(goal) {
    const value = Math.max(0, U.num(goal));
    if (!(value > 0)) return false;
    state.goal = value;
    save();
    return true;
  }

  function setSettings(patch) {
    Object.assign(state.settings, patch || {});
    state.settings.syncUrl = String(state.settings.syncUrl || "").trim();
    state.settings.syncKey = String(state.settings.syncKey || "").trim();
    state.settings.auto = state.settings.auto !== false;
    // 同步配置只属于本机，不参与云端合并，也不能因此把 updatedAt 推新
    save({ touch: false, push: false });
  }

  /* ---------- 备份与导入导出 ---------- */
  function backup(reason) {
    const payload = {
      at: Date.now(),
      reason: reason || "manual",
      state: JSON.parse(JSON.stringify(state)),
    };
    safeSet(BACKUP_KEY, JSON.stringify(payload));
    return payload;
  }

  function getBackup() {
    return safeParse(safeGet(BACKUP_KEY));
  }

  function restoreBackup() {
    const b = getBackup();
    if (!b || !b.state) return false;
    replace(b.state, { backup: false });
    save({ touch: false, push: true });
    return true;
  }

  function exportJson() {
    const snapshot = JSON.parse(JSON.stringify(state));
    // 导出文件可能被转发/上传，剔除只属于本机的同步密钥
    snapshot.settings = Object.assign({}, snapshot.settings, { syncKey: "" });
    return JSON.stringify(
      {
        app: "dividend-workbench",
        schema: SCHEMA,
        exportedAt: new Date().toISOString(),
        state: snapshot,
      },
      null,
      2
    );
  }

  function exportFile() {
    U.download("攒股收息备份-" + U.today() + ".json", exportJson());
  }

  function normalizeImport(input) {
    if (!input || typeof input !== "object") throw new Error("文件内容不是有效的 JSON");
    const candidate = input.state && typeof input.state === "object" ? input.state : input;
    if (!Array.isArray(candidate.stocks)) throw new Error("备份里没有找到持仓数据");
    return migrate(candidate);
  }

  async function importFile(file) {
    const text = await U.readFile(file);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("JSON 格式不正确");
    }
    return normalizeImport(parsed);
  }

  function replaceFromImport(next) {
    replace(next, { backup: true, preserveSettings: true });
    save({ touch: true, push: true });
  }

  /* ---------- 同步元信息（仅本机，不参与云端同步） ---------- */
  function syncMeta() {
    return safeParse(safeGet(META_KEY)) || { at: 0, ok: null, message: "" };
  }

  function setSyncMeta(meta) {
    const value = Object.assign({ at: 0, ok: null, message: "" }, meta || {});
    safeSet(META_KEY, JSON.stringify(value));
    emit("sync:meta", value);
    return value;
  }

  function initEvents() {
    if (stateListenersReady) return;
    stateListenersReady = true;
    // 兼容其他模块订阅
    App.bus = { on, emit };
  }

  initEvents();

  App.store = {
    LS_KEY,
    BACKUP_KEY,
    SCHEMA,
    state,
    on,
    emit,
    save,
    replace,
    totals,
    getStock,
    addStock,
    updateStock,
    deleteStock,
    addReceipt,
    addTrade,
    deleteReceipt,
    setGoal,
    setSettings,
    backup,
    getBackup,
    restoreBackup,
    exportJson,
    exportFile,
    importFile,
    replaceFromImport,
    syncMeta,
    setSyncMeta,
  };
})(window.App = window.App || {});
