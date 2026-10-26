/* 攒股收息 · 设置页 */
(function (App) {
  "use strict";

  const U = App.util;
  const $ = U.$;

  function endpointText() {
    const url = App.sync.defaultUrl();
    if (/^https?:/i.test(url)) return url;
    return location.origin + url;
  }

  function render() {
    const app = document.getElementById("app");
    const state = App.store.state;
    const settings = state.settings || {};
    const backup = App.store.getBackup();
    const installed = App.ui.isInstalled();

    app.innerHTML = `
      <div class="home-head settings-head">
        <h2><i></i>设置</h2>
        <span class="tag">v${U.esc(App.version || "2.1.0")}</span>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>年度股息目标</h2></div>
        <form class="form" id="goal-form" novalidate>
          <div class="field">
            <label for="s-goal">目标金额（元 / 年）</label>
            <input id="s-goal" type="number" inputmode="decimal" step="any" value="${state.goal}">
            <div class="hint">目标会显示在总览进度条上，可随时修改。</div>
          </div>
          <div class="btn-row"><button class="btn" type="submit" id="goal-btn">保存目标</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>数据同步</h2>
          <span class="tag">Cloudflare · 电脑 / 手机互通</span>
        </div>
        <div class="form">
          <div class="sync-status-row">
            <span class="dot" id="sync-dot"></span>
            <span id="sync-status" class="syncstatus">尚未同步</span>
            <span id="last-sync" class="last-sync"></span>
          </div>

          <div class="field">
            <label for="s-key">同步密钥</label>
            <div class="input-with-btn">
              <input id="s-key" type="password" autocomplete="off" value="${U.esc(settings.syncKey)}"
                placeholder="见部署电脑上的 同步密钥.txt">
              <button class="btn ghost small" type="button" id="toggle-key">显示</button>
            </div>
            <div class="hint">每台设备填一次，所有设备用同一个密钥。密钥只保存在本机，不会上传到云端。</div>
          </div>

          <div class="field">
            <label for="s-url">同步地址</label>
            <input id="s-url" value="${U.esc(settings.syncUrl)}" placeholder="${U.esc(endpointText())}"
              autocomplete="off">
            <div class="hint">留空即使用自动地址：<code>${U.esc(endpointText())}</code></div>
          </div>

          <label class="chk">
            <input id="s-auto" type="checkbox" ${settings.auto !== false ? "checked" : ""}>
            <span>自动同步（改动后自动上传，打开时自动拉取较新数据）</span>
          </label>

          <div class="btn-row">
            <button class="btn" type="button" id="sync-save-btn">保存设置</button>
            <button class="btn ghost" type="button" id="sync-now-btn">立即同步</button>
            <button class="btn ghost" type="button" id="sync-test-btn">测试连接</button>
            <button class="btn ghost" type="button" id="copy-config-btn">复制配置</button>
          </div>

          <div class="hint sync-note">
            数据存放在你自己的 Cloudflare 账号（420775251@qq.com）的 KV 存储中，以最后修改时间为准。
            换设备时填同一个同步地址和密钥，即可拉取云端数据。
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>数据备份</h2>
          <span class="tag">建议定期导出</span>
        </div>
        <div class="form">
          <div class="btn-row">
            <button class="btn ghost" type="button" id="export-btn">导出 JSON 备份</button>
            <button class="btn ghost" type="button" id="import-btn">导入备份</button>
            <button class="btn ghost" type="button" id="restore-btn" ${
              backup ? "" : "disabled"
            }>恢复云端覆盖前备份</button>
          </div>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
          <div class="hint">导出的文件包含全部持仓和收息记录，不含同步密钥。导入会覆盖当前数据，请先导出备份。</div>
          <div class="hint" id="backup-hint">${
            backup
              ? "本机备份时间：" + U.timeAgo(backup.at) + "（上一次云端覆盖本地前自动保存）"
              : "还没有自动备份。"
          }</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>安装到手机桌面</h2>
          <span class="tag">${installed ? "已安装" : "PWA"}</span>
        </div>
        <div class="form">
          <div class="btn-row">
            <button class="btn" type="button" data-install id="install-btn" ${
              installed ? "disabled" : ""
            }>${installed ? "已安装" : "安装 App"}</button>
          </div>
          <div class="hint" id="install-hint">
            安卓 Chrome：菜单 →「添加到主屏幕 / 安装应用」；iPhone Safari：分享 →「添加到主屏幕」。
          </div>
          <div class="hint">安装后可以像普通 App 一样从桌面打开，支持离线查看；首次打开需要联网加载。</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>关于</h2></div>
        <div class="about-note">
          攒股收息 · 退休计划 v${U.esc(App.version || "2.1.0")}<br>
          行情来自腾讯证券，分红数据来自东方财富公开数据，仅供参考，请以券商实际到账为准。<br>
          数据默认保存在本机浏览器；配置同步后存入你自己的 Cloudflare KV。<br>
          源码：<a href="https://github.com/xiaohaichong09/dividend-workbench" target="_blank"
            rel="noopener">github.com/xiaohaichong09/dividend-workbench</a>
        </div>
      </section>

      <div class="page-foot">把每一笔分红，变成退休后的现金流。</div>
    `;

    /* ---------- 目标 ---------- */
    $("#goal-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const goal = U.num($("#s-goal").value);
      if (!(goal > 0)) {
        App.ui.toast("请填写有效的目标金额", "err");
        $("#s-goal").focus();
        return;
      }
      App.store.setGoal(goal);
      App.ui.toast("目标已更新", "ok");
      routeTo("#/");
    });

    /* ---------- 同步 ---------- */
    const keyInput = $("#s-key");
    const urlInput = $("#s-url");
    const autoInput = $("#s-auto");

    function persistSync() {
      App.store.setSettings({
        syncKey: keyInput.value.trim(),
        syncUrl: urlInput.value.trim(),
        auto: autoInput.checked,
      });
    }

    $("#toggle-key").addEventListener("click", (e) => {
      const show = keyInput.type === "password";
      keyInput.type = show ? "text" : "password";
      e.currentTarget.textContent = show ? "隐藏" : "显示";
    });

    $("#sync-save-btn").addEventListener("click", () => {
      persistSync();
      App.ui.toast("同步设置已保存", "ok");
      App.ui.refreshSyncStatus();
      App.ui.setSyncChip(
        keyInput.value.trim() ? (App.store.syncMeta().ok === false ? "err" : "ok") : "off",
        keyInput.value.trim() ? "同步已开启" : "未配置同步"
      );
      if (keyInput.value.trim()) App.sync.syncNow({ manual: false });
    });

    $("#sync-now-btn").addEventListener("click", async (e) => {
      persistSync();
      App.ui.setBusy(e.currentTarget, true, "同步中…");
      try {
        await App.sync.syncNow({ manual: true });
      } finally {
        App.ui.setBusy(e.currentTarget, false);
        App.ui.refreshSyncStatus();
      }
    });

    $("#sync-test-btn").addEventListener("click", async (e) => {
      persistSync();
      App.ui.setBusy(e.currentTarget, true, "测试中…");
      try {
        await App.sync.test();
      } finally {
        App.ui.setBusy(e.currentTarget, false);
      }
    });

    $("#copy-config-btn").addEventListener("click", async () => {
      persistSync();
      const text =
        "攒股收息同步配置\n地址：" +
        (urlInput.value.trim() || endpointText()) +
        "\n密钥：" +
        keyInput.value.trim();
      try {
        await navigator.clipboard.writeText(text);
        App.ui.toast("同步配置已复制，可发到手机粘贴", "ok");
      } catch (e) {
        App.ui.toast("复制失败，请手动填写", "err");
      }
    });

    /* ---------- 备份 ---------- */
    $("#export-btn").addEventListener("click", () => {
      App.store.exportFile();
      App.ui.toast("已导出备份文件", "ok");
    });

    const importFile = $("#import-file");
    $("#import-btn").addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", async () => {
      const file = importFile.files && importFile.files[0];
      importFile.value = "";
      if (!file) return;
      try {
        const next = await App.store.importFile(file);
        const ok = await App.ui.confirm(
          "导入将覆盖当前 " +
            App.store.state.stocks.length +
            " 只标的的数据，备份中有 " +
            next.stocks.length +
            " 只。确定继续？",
          { okText: "覆盖导入" }
        );
        if (!ok) return;
        App.store.replaceFromImport(next);
        App.ui.toast("导入成功", "ok");
        routeTo("#/");
      } catch (e) {
        App.ui.toast("导入失败：" + (e.message || "文件格式不正确"), "err");
      }
    });

    const restoreBtn = $("#restore-btn");
    if (backup) {
      restoreBtn.addEventListener("click", async () => {
        const ok = await App.ui.confirm(
          "恢复到 " + U.timeAgo(backup.at) + " 的自动备份？当前数据会被覆盖。",
          { okText: "恢复" }
        );
        if (!ok) return;
        if (App.store.restoreBackup()) {
          App.ui.toast("已恢复备份", "ok");
          routeTo("#/");
        } else {
          App.ui.toast("没有可用的备份", "err");
        }
      });
    }

    /* ---------- 安装 ---------- */
    const installBtn = $("#install-btn");
    if (installBtn) {
      installBtn.addEventListener("click", async () => {
        const ok = await App.ui.promptInstall();
        if (ok) {
          App.ui.toast("已安装，可从桌面打开", "ok");
          App.ui.refreshInstallUI();
        }
      });
    }

    App.ui.refreshInstallUI();
    App.ui.refreshSyncStatus();
    const meta = App.store.syncMeta();
    const dot = $("#sync-dot");
    if (dot) {
      dot.dataset.state = !settings.syncKey
        ? "off"
        : meta.ok === true
        ? "ok"
        : meta.ok === false
        ? "err"
        : "idle";
    }
  }

  function routeTo(hash) {
    if (location.hash === hash) {
      if (App.router && App.router.render) App.router.render();
    } else {
      location.hash = hash;
    }
  }

  App.views = App.views || {};
  App.views.settings = { render };
})(window.App = window.App || {});
