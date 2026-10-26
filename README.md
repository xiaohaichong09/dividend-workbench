# 攒股收息 · 退休计划

一个可以装进手机桌面的「攒股收息」工作台：记录持仓、追踪年度股息目标、记录实际到账分红，电脑和手机通过 Cloudflare 同步。

**在线使用（推荐）**：<https://dividend-app-cym.pages.dev>

- 安卓 Chrome / iPhone Safari 打开上面的网址，添加到主屏幕即可像 App 一样使用。
- 数据默认只存在当前设备浏览器里；在「设置 → 数据同步」填写同步密钥后，电脑和手机会自动互相同步。
- 同步密钥只保存在本机，不会上传到云端，也不在 GitHub 仓库里。

## 功能

- **年度目标卡**：当前年度股息总额、完成百分比、目标金额、进度条，以及已收 / 成本 / 市值 / 还差 / 成本股息率。
- **持仓卡片**：攒股数量、当前股价、持仓成本、近一年每股分红、当前股息率、成本股息率、盈亏比例、预计当年分红。
- **标的编辑**：输入 6 位代码自动识别名称、股价，并拉取东方财富分红记录；按近 12 个月合计给出「每股分红」建议，确认后再保存。
- **仓位变动**：每只标的可记录加仓 / 减仓（日期、数量、成交价、手续费、备注）。加仓自动重算持仓成本，减仓按当前成本结算已实现盈亏；减到 0 股即为清仓，**历史收息和已实现盈亏都会保留**，之后到账的分红还能继续记。
- **已清仓区**：总览单独列出已清仓标的，显示累计收息与已实现盈亏；年度预计分红自动归零，但历史收息仍计入累计。
- **收息记录**：每只标的可记多笔到账分红（日期 + 金额 + 备注），总览的「已到账」按本年度自动累计。
- **行情刷新**：腾讯行情接口，支持沪 / 深 / 北交所 / 场内 ETF。
- **本地优先**：所有数据先写入浏览器 `localStorage`，断网也能查看和记账；有网时再同步。
- **PWA**：离线缓存、桌面图标、iOS 启动图、快捷方式（添加标的 / 同步设置）。
- **备份**：一键导出 / 导入 JSON；云端覆盖本地前会自动留一份本机备份。

> 分红口径：A 股公告写「每 10 股派 X 元」，工具里填**每股**（X ÷ 10）。

## 手机安装

### 安卓（Chrome / Edge）

1. 打开 <https://dividend-app-cym.pages.dev>
2. 右上角菜单 →「安装应用」或「添加到主屏幕」
3. 从桌面图标打开，即为全屏 App 模式

### iPhone / iPad（Safari）

1. 用 **Safari** 打开 <https://dividend-app-cym.pages.dev>
2. 点底部「分享」→「添加到主屏幕」
3. 从桌面图标打开（首次打开需要联网）

> 微信内置浏览器不支持安装，请点右上角「在浏览器中打开」。

## 电脑 ↔ 手机同步

同步使用你自己的 Cloudflare 账号（`420775251@qq.com`）里的 KV 存储，不经过第三方服务器。

1. 在电脑上打开 App →「设置 → 数据同步」。
2. 「同步密钥」填入部署电脑上的 `同步密钥.txt` 里那行密钥；「同步地址」**留空**（自动使用当前站点）。
3. 点「保存设置」→「立即同步」。
4. 手机上打开同一个网址，填入**同一个密钥**，保存并同步，即可看到电脑上的数据。

说明：

- 以 `updatedAt`（最后修改时间）较新的一方为准；两台设备同时改同一条记录时，后保存的覆盖先保存的。
- 密钥只保存在本机 `localStorage`，上传前会从数据里剔除；Cloudflare 端也会把 `settings` 重置为空。
- GitHub Pages 或本地双击 `index.html` 打开时，会自动回退到 `https://dividend-app-cym.pages.dev/api/sync`。
- 换手机 / 清除浏览器数据前，建议先「导出 JSON 备份」。

## 本地使用

直接双击 `index.html` 即可（经典脚本，不依赖构建工具，兼容 `file://`）。

想在本机调试同步接口，可以起一个静态服务器：

```powershell
py -m http.server 8765 --bind 127.0.0.1
```

然后打开 <http://127.0.0.1:8765/>。注意本地静态服务器没有 `/api/sync`，同步会失败，属于正常现象。

## 部署

### Cloudflare Pages（主站，含同域同步接口）

```powershell
py -m pip install blake3
py scripts\deploy_cloudflare.py
```

脚本会：

1. 读取 Cloudflare API Token（`CLOUDFLARE_API_TOKEN` → `scripts/cf_token.txt` → `../Index 2/tools/cf_token.txt`）。
2. 找到或创建 KV 命名空间 `dividend-workbench`。
3. 给 Pages 项目绑定 `KV` 与 `SYNC_KEY`（Secret）。
4. 通过 Direct Upload 上传静态资源，并把 `_worker.js` 作为 Functions 一起部署。
5. 部署独立 Worker `dividend-sync`（备用）。
6. 用真实请求验证首页、`/api/health`、`/api/sync` 鉴权。

只部署页面或只部署 Worker：

```powershell
py scripts\deploy_cloudflare.py --pages-only
py scripts\deploy_cloudflare.py --worker-only
```

主项目 `dividend-app`（<https://dividend-app-cym.pages.dev>），备用项目 `dividend`（<https://dividend-45f.pages.dev>），内容一致。

### GitHub Pages（源码镜像 / 备用站）

仓库：<https://github.com/xiaohaichong09/dividend-workbench>

在仓库 **Settings → Pages** 选择 `main` 分支根目录即可。GitHub Pages 没有后端，页面会自动使用 Cloudflare 的同步接口；PWA 的 Service Worker、图标均使用相对路径，子目录部署也能正常安装。

### 同步接口

| 路径 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查，返回 KV / 密钥是否绑定 |
| `GET /api/sync` | 读取云端状态（需要 `X-Auth-Key`） |
| `PUT /api/sync` | 上传整份状态（需要 `X-Auth-Key`） |

鉴权头：`X-Auth-Key: <同步密钥>`。云端只存 `goal`、`stocks`、`updatedAt` 等业务数据，`settings` 会被重置为空。

## 目录结构

```
Dividend/
├── index.html                 # 应用壳、PWA meta、启动图
├── css/style.css              # 深色金融风格 / 响应式
├── js/
│   ├── core/
│   │   ├── util.js            # 工具函数
│   │   ├── store.js           # 本地状态、统计、备份、导入导出
│   │   ├── ui.js              # Toast、确认框、安装提示、同步指示灯
│   │   └── sync.js            # Cloudflare 同步
│   ├── services/
│   │   ├── quotes.js          # 腾讯行情
│   │   └── dividends.js       # 东方财富分红
│   ├── views/
│   │   ├── overview.js        # 总览
│   │   ├── stock.js           # 标的编辑 / 收息记录
│   │   └── settings.js        # 设置 / 同步 / 备份 / 安装
│   └── app.js                 # 路由、启动、SW 更新
├── manifest.webmanifest       # PWA 配置
├── sw.js                      # 离线缓存与更新
├── offline.html / 404.html
├── icons/                     # 图标 + iOS 启动图
├── _worker.js                 # Cloudflare Pages Functions（/api/sync）
├── worker/                    # 独立同步 Worker（备用）
├── scripts/
│   ├── deploy_cloudflare.py   # 一键部署
│   └── make_icons.py          # 图标 / 启动图生成
├── docs/DEPLOY.md             # 详细部署说明
└── 同步密钥.txt                # 仅本机，已被 .gitignore 排除
```

## 数据与隐私

- 持仓、收息记录、目标、同步密钥都保存在浏览器 `localStorage`，不会上传到 GitHub。
- 上传到 Cloudflare 的数据只包含业务字段；`settings.syncKey` 在前端上传前和 Worker 接收时都会被清空。
- 导出的 JSON 备份同样会剔除同步密钥，可以安全转发。
- 行情 / 分红来自腾讯、东方财富公开接口，仅供参考，请以券商实际到账为准。

## 常见问题

- **年度股息总额大了 10 倍**：公告是「每 10 股派 X 元」，每股应填 X ÷ 10。
- **刷新行情没反应**：标的必须填 6 位代码；接口在个别网络环境可能访问不到，可手动填股价。
- **手机上填了密钥但同步失败**：先确认网址是 `https://` 且能正常打开；再点「测试连接」看提示。
- **更新后手机还是旧版**：页面会提示「发现新版本」，点「立即更新」；或关闭 App 后重新打开。
- **卖出股票后收息记录没了？** 不要用「删除标的」，请在标的页用「仓位变动 → 减仓 / 卖出」把数量减到 0；标的会进入「已清仓」，历史收息和已实现盈亏都会保留。
- **换设备数据不见了**：数据在浏览器本地，换设备前先配置同步，或导出 JSON 备份再导入。
